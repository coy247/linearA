/**
 * miner_core.c — Native multi-threaded mining subprocess.
 *
 * voynich-lowered SHA-256 double-hash with pthreads parallelism.
 * Runs as a child process of the Deno miner. All hashing happens
 * in native code — zero JS overhead in the hot path.
 *
 * Protocol (binary, little-endian over stdin/stdout):
 *
 *   → stdin (from Deno):
 *     CMD_JOB (0x01):
 *       u8   cmd = 0x01
 *       u32  midstate[8]     (32 bytes)
 *       u32  tailblock[16]   (64 bytes)
 *       u32  target_zero_words
 *       u32  nonce_start
 *       u32  nonce_end
 *       u8   target_be[32]   (full target for byte-level check)
 *       u32  target_zero_count (byte-level)
 *       u32  nonce_stride    (EDI gear stride — 1 = linear scan, G = gear-only)
 *       = 1 + 32 + 64 + 4 + 4 + 4 + 32 + 4 + 4 = 149 bytes
 *
 *     CMD_STOP (0x02):
 *       u8   cmd = 0x02
 *       = 1 byte
 *
 *     CMD_QUERY_HASHCOUNT (0x03):
 *       u8   cmd = 0x03
 *       = 1 byte
 *
 *   ← stdout (to Deno):
 *     MSG_SHARE (0x01):
 *       u8   msg = 0x01
 *       u32  nonce
 *       u32  ntime    (actual ntime this thread used — LE)
 *       u8   hash[32]
 *       = 37 bytes
 *
 *     MSG_HASHCOUNT (0x02):
 *       u8   msg = 0x02
 *       u64  total_hashes
 *       = 9 bytes
 *
 *     MSG_DONE (0x03):
 *       u8   msg = 0x03
 *       = 1 byte
 *
 *     MSG_READY (0x04):
 *       u8   msg = 0x04
 *       u32  thread_count
 *       = 5 bytes
 *
 * Compilation (handled by build.sh):
 *   macOS:  cc -O3 -march=native -pthread -o miner_core miner_core.c sha256_native.c
 *   Linux:  cc -O3 -march=native -pthread -o miner_core miner_core.c sha256_native.c -lrt
 *
 * booLang IR compliance: all SHA-256 operations are the voynich-lowered
 * native forms from sha256_native.c. Threading is infrastructure, not
 * computation — the IR invariants hold within each thread.
 */

#include <stdio.h>
#include <stdlib.h>
#include <stdint.h>
#include <string.h>
#include <pthread.h>
#include <unistd.h>

#ifdef __APPLE__
#include <sys/sysctl.h>
#else
#include <time.h>
#endif

/* ── Import from sha256_native.c ──────────────────────────────────── */

typedef struct {
    uint32_t midstate[8];
    uint32_t tailblock[16];
    uint32_t result[8];
    uint32_t W[64];
} sha256_ctx_t;

extern sha256_ctx_t* sha256_create_context(void);
extern void sha256_destroy_context(sha256_ctx_t*);
extern void sha256_set_midstate(sha256_ctx_t*, const uint32_t[8]);
extern void sha256_set_tailblock(sha256_ctx_t*, const uint32_t[16]);
extern void sha256_hash_with_nonce(sha256_ctx_t*, uint32_t);
extern uint32_t sha256_get_result_word(const sha256_ctx_t*, int);
extern void sha256_get_result(const sha256_ctx_t*, uint32_t[8]);

/* ── Shared state ─────────────────────────────────────────────────── */

static volatile int g_running = 0;       /* 1 when a job is active */
static volatile int g_stop = 0;          /* 1 when stop requested */
static volatile uint64_t g_hash_count = 0; /* atomic on most platforms */

/* Job parameters (set by main thread, read by workers) */
static uint32_t g_midstate[8];
static uint32_t g_tailblock[16];
static int g_target_zero_words;
static uint8_t g_target_be[32];
static int g_target_zero_count;
static uint32_t g_nonce_start;
static uint32_t g_nonce_end;
static uint32_t g_nonce_stride = 1;   /* EDI gear stride; 1 = full scan */

/* Output mutex for stdout writes */
static pthread_mutex_t g_out_mutex = PTHREAD_MUTEX_INITIALIZER;

/* ── Platform helpers ─────────────────────────────────────────────── */

static int get_cpu_count(void) {
#ifdef __APPLE__
    int count;
    size_t size = sizeof(count);
    if (sysctlbyname("hw.ncpu", &count, &size, NULL, 0) == 0)
        return count;
    return 4;
#else
    long n = sysconf(_SC_NPROCESSORS_ONLN);
    return n > 0 ? (int)n : 4;
#endif
}

/* ── Target comparison ────────────────────────────────────────────── */

static int hash_meets_target(const uint8_t hash[32],
                             const uint8_t target_be[32],
                             int leading_zeros) {
    for (int i = 0; i < leading_zeros; i++) {
        if (hash[31 - i] != 0) return 0;
    }
    for (int i = leading_zeros; i < 32; i++) {
        uint8_t h = hash[31 - i];
        uint8_t t = target_be[i];
        if (h < t) return 1;
        if (h > t) return 0;
    }
    return 1;
}

/* Convert result words to big-endian hash bytes */
static void result_to_hash(const uint32_t words[8], uint8_t out[32]) {
    for (int i = 0; i < 8; i++) {
        uint32_t w = words[i];
        out[i*4]   = (w >> 24) & 0xff;
        out[i*4+1] = (w >> 16) & 0xff;
        out[i*4+2] = (w >> 8)  & 0xff;
        out[i*4+3] =  w        & 0xff;
    }
}

/* ── Send share hit to stdout ─────────────────────────────────────── */

static void send_share(uint32_t nonce, uint32_t ntime, const uint8_t hash[32]) {
    uint8_t buf[41];
    buf[0] = 0x01; /* MSG_SHARE */
    memcpy(buf + 1, &nonce, 4);
    memcpy(buf + 5, &ntime, 4);   /* ntime LE — exact value used for hashing */
    memcpy(buf + 9, hash, 32);

    pthread_mutex_lock(&g_out_mutex);
    fwrite(buf, 1, 41, stdout);
    fflush(stdout);
    pthread_mutex_unlock(&g_out_mutex);
}

/* ── Worker thread ────────────────────────────────────────────────── */

typedef struct {
    int thread_id;
    int thread_count;
} worker_arg_t;

static void* worker_fn(void* arg) {
    worker_arg_t* wa = (worker_arg_t*)arg;
    int tid = wa->thread_id;
    int tc = wa->thread_count;

    /* Each thread gets its own context — zero contention */
    sha256_ctx_t* ctx = sha256_create_context();
    if (!ctx) return NULL;

    /* Per-thread ntime: g_tailblock[1] is the ntime stored as a big-endian
     * SHA-256 word. bswap32 gives the actual Unix timestamp (seconds).
     *
     * Temporal rate decomposition — component freeze table:
     *   year/month/day/hour : frozen within any mining job (< 10 min)
     *   minute              : usually frozen; wraps ~once per job at most
     *   second (bits 0-5)   : VARIANT — tid offsets exclusively land here
     *
     * booLang IR: invariant-at-rate-R components are never recomputed.
     * tid=0..6 increments only the "second" field — the fastest non-ms
     * component. Frozen prefix is identical across all threads and pools.
     * Pool tolerance: ±2h from real time. A tid=6 offset = +6 seconds. */
    uint32_t base_ntime = __builtin_bswap32(g_tailblock[1]);
    uint32_t my_ntime   = base_ntime + (uint32_t)tid;

    uint32_t local_tailblock[16];
    memcpy(local_tailblock, g_tailblock, 64);
    local_tailblock[1] = __builtin_bswap32(my_ntime);

    sha256_set_midstate(ctx, g_midstate);
    sha256_set_tailblock(ctx, local_tailblock);

    /* Divide nonce range across threads.
     * NACHA batch model: the full [start,end] range is pre-sorted into
     * stride-aligned nonces (gear-multiples only). Each thread gets a
     * contiguous slice of that logical batch and steps by stride within
     * its slice — covering disjoint gear-multiples, no overlap, no gaps.
     *
     * Thread 0: gear-multiples in [start, start+per_thread)
     * Thread 1: gear-multiples in [start+per_thread, start+2*per_thread)
     * Thread N: gear-multiples in its slice, aligned to first gear-multiple
     *
     * This is correct: all threads hash only gear-multiples, load balanced. */
    uint64_t stride      = (uint64_t)g_nonce_stride;
    uint64_t total_range = (uint64_t)g_nonce_end - (uint64_t)g_nonce_start + 1;
    uint64_t per_thread  = total_range / tc;
    uint64_t raw_start   = (uint64_t)g_nonce_start + (uint64_t)tid * per_thread;
    uint64_t my_end      = (tid == tc - 1) ? (uint64_t)g_nonce_end
                                           : raw_start + per_thread - 1;
    /* Align my_start to first stride-multiple >= raw_start */
    uint64_t my_start;
    if (stride > 1) {
        my_start = ((raw_start + stride - 1) / stride) * stride;
    } else {
        my_start = raw_start;
    }

    uint64_t local_count = 0;
    const int FLUSH_INTERVAL = 65536;
    const int STOP_CHECK_INTERVAL = 256; /* check g_stop every N hashes, not every 1 */

    for (uint64_t n = my_start; n <= my_end; n += stride) {
        /* Volatile g_stop read every 256 hashes instead of every hash.
         * Eliminates per-nonce cache-busting memory load in the hot path.
         * 256-nonce granularity: stop latency < 1µs at any realistic hash rate. */
        if ((n & (STOP_CHECK_INTERVAL - 1)) == 0 && g_stop) break;

        uint32_t nonce = (uint32_t)n;
        sha256_hash_with_nonce(ctx, nonce);
        local_count++;

        /* 1D word-level fast rejection */
        int pass = 1;
        for (int w = 7; w > 7 - g_target_zero_words; w--) {
            if (sha256_get_result_word(ctx, w) != 0) { pass = 0; break; }
        }

        if (pass) {
            /* Full byte-level verification */
            uint32_t words[8];
            sha256_get_result(ctx, words);
            uint8_t hash[32];
            result_to_hash(words, hash);

            if (hash_meets_target(hash, g_target_be, g_target_zero_count)) {
                send_share(nonce, my_ntime, hash);
            }
        }

        /* Periodic hash count flush */
        if (local_count >= FLUSH_INTERVAL) {
            __sync_fetch_and_add(&g_hash_count, local_count);
            local_count = 0;
        }
    }

    /* Final flush */
    if (local_count > 0) {
        __sync_fetch_and_add(&g_hash_count, local_count);
    }

    sha256_destroy_context(ctx);
    free(wa);
    return NULL;
}

/* ── Read exactly n bytes from stdin ──────────────────────────────── */

static int read_exact(void* buf, size_t n) {
    size_t total = 0;
    while (total < n) {
        size_t r = fread((uint8_t*)buf + total, 1, n - total, stdin);
        if (r == 0) return -1; /* EOF or error */
        total += r;
    }
    return 0;
}

/* ── Main loop ────────────────────────────────────────────────────── */

int main(void) {
    /* Thread budget: honour BOOLANG_NATIVE_THREADS env var if set,
       otherwise claim all available cores. The TypeScript bridge sets
       this when WASM co-engines need CPU headroom. */
    int nthreads;
    const char* env_threads = getenv("BOOLANG_NATIVE_THREADS");
    if (env_threads && atoi(env_threads) > 0) {
        nthreads = atoi(env_threads);
    } else {
        nthreads = get_cpu_count();
    }
    pthread_t* threads = NULL;

    /* Send READY message */
    {
        uint8_t buf[5];
        buf[0] = 0x04; /* MSG_READY */
        memcpy(buf + 1, &nthreads, 4);
        fwrite(buf, 1, 5, stdout);
        fflush(stdout);
    }

    /* Disable buffering on stdin for binary protocol */
    setbuf(stdin, NULL);

    while (1) {
        uint8_t cmd;
        if (read_exact(&cmd, 1) < 0) break; /* EOF = parent died */

        switch (cmd) {

        case 0x01: { /* CMD_JOB */
            /* Stop any running job */
            if (g_running) {
                g_stop = 1;
                if (threads) {
                    for (int i = 0; i < nthreads; i++)
                        pthread_join(threads[i], NULL);
                    free(threads);
                    threads = NULL;
                }
                g_running = 0;
            }

            /* Read job parameters */
            uint8_t job_buf[148]; /* 32 + 64 + 4 + 4 + 4 + 32 + 4 + 4 */
            if (read_exact(job_buf, 148) < 0) goto done;

            int off = 0;
            memcpy(g_midstate, job_buf + off, 32);    off += 32;
            memcpy(g_tailblock, job_buf + off, 64);   off += 64;
            memcpy(&g_target_zero_words, job_buf + off, 4); off += 4;
            memcpy(&g_nonce_start, job_buf + off, 4); off += 4;
            memcpy(&g_nonce_end, job_buf + off, 4);   off += 4;
            memcpy(g_target_be, job_buf + off, 32);   off += 32;
            memcpy(&g_target_zero_count, job_buf + off, 4); off += 4;
            memcpy(&g_nonce_stride, job_buf + off, 4);
            if (g_nonce_stride < 1) g_nonce_stride = 1;   /* guard: never 0 */

            /* Reset state */
            g_stop = 0;
            g_hash_count = 0;
            g_running = 1;

            /* Spawn worker threads */
            threads = (pthread_t*)malloc(sizeof(pthread_t) * nthreads);
            for (int i = 0; i < nthreads; i++) {
                worker_arg_t* wa = (worker_arg_t*)malloc(sizeof(worker_arg_t));
                wa->thread_id = i;
                wa->thread_count = nthreads;
                pthread_create(&threads[i], NULL, worker_fn, wa);
            }
            break;
        }

        case 0x02: { /* CMD_STOP */
            g_stop = 1;
            if (threads) {
                for (int i = 0; i < nthreads; i++)
                    pthread_join(threads[i], NULL);
                free(threads);
                threads = NULL;
            }
            g_running = 0;

            /* Send DONE */
            uint8_t done_msg = 0x03;
            pthread_mutex_lock(&g_out_mutex);
            fwrite(&done_msg, 1, 1, stdout);
            fflush(stdout);
            pthread_mutex_unlock(&g_out_mutex);
            break;
        }

        case 0x03: { /* CMD_QUERY_HASHCOUNT */
            uint64_t count = g_hash_count;
            uint8_t buf[9];
            buf[0] = 0x02; /* MSG_HASHCOUNT */
            memcpy(buf + 1, &count, 8);

            pthread_mutex_lock(&g_out_mutex);
            fwrite(buf, 1, 9, stdout);
            fflush(stdout);
            pthread_mutex_unlock(&g_out_mutex);
            break;
        }

        default:
            /* Unknown command — skip */
            break;
        }
    }

done:
    /* Clean up */
    if (threads) {
        g_stop = 1;
        for (int i = 0; i < nthreads; i++)
            pthread_join(threads[i], NULL);
        free(threads);
    }

    return 0;
}
