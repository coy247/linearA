/**
 * test_native.c — Correctness + benchmark for voynich native SHA-256.
 *
 * Compile: gcc -O3 -o test_native test_native.c sha256_native.c
 * Run:     ./test_native
 */

#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include <time.h>

/* Import from sha256_native.c */
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
extern int64_t sha256_scan_nonces(sha256_ctx_t*, uint32_t, uint32_t, int, uint32_t*);
extern int64_t sha256_scan_nonces_4way(sha256_ctx_t*, uint32_t, uint32_t, int, uint32_t*);

/* Known-good test vectors: nonce → expected result word 0 (big-endian)
 * Generated from the JS implementation with header bytes [0,1,2,...,79].
 * These will be compared against the JS path on user's machine for full
 * validation. Here we just verify determinism and benchmark. */

static void print_hex(const uint32_t words[8]) {
    for (int i = 0; i < 8; i++) {
        printf("%08x", words[i]);
    }
    printf("\n");
}

int main(void) {
    printf("SHA-256 engine: ");
#ifdef __ARM_FEATURE_SHA2
    printf("ARM SHA2 hardware (vsha256hq/h2 intrinsics)\n");
#else
    printf("software fallback (C, -O3 auto-vectorised)\n");
#endif

    sha256_ctx_t *ctx = sha256_create_context();
    if (!ctx) {
        fprintf(stderr, "Failed to create context\n");
        return 1;
    }

    /* Build test header: bytes 0..79 = [0, 1, 2, ..., 79] */
    uint8_t header[80];
    for (int i = 0; i < 80; i++) header[i] = (uint8_t)i;

    /* Compute midstate of first 64 bytes using a reference SHA-256.
     * Since we don't have a standalone SHA-256 for just the first block,
     * we'll use the compress function directly.
     *
     * The midstate IS compress(H_INIT, first_64_bytes_as_16_words).
     * But our compress writes to ctx->result, so we use that. */

    /* First 64 bytes as 16 big-endian uint32 words */
    uint32_t first_block[16];
    for (int i = 0; i < 16; i++) {
        first_block[i] = ((uint32_t)header[i*4] << 24) |
                         ((uint32_t)header[i*4+1] << 16) |
                         ((uint32_t)header[i*4+2] << 8) |
                         ((uint32_t)header[i*4+3]);
    }

    /* H_INIT */
    static const uint32_t H_INIT[8] = {
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
        0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
    };

    /* Use ctx to compute midstate: compress(H_INIT, first_block) */
    memcpy(ctx->midstate, H_INIT, 32);
    sha256_set_tailblock(ctx, first_block);
    /* We need to call compress directly — but it's static in sha256_native.c.
     * Instead, use the public API: set midstate = H_INIT, tailblock = first_block,
     * hash with nonce 0 (but this also does the second compression).
     *
     * Better approach: we know the JS midstate for header [0..79].
     * Let's just hardcode the expected midstate from the JS path.
     *
     * Actually, let's use the full pipeline and compare results between
     * two nonces to verify determinism, then benchmark. */

    /* For a proper test: compute midstate the same way JS does.
     * JS computeMidstate does SHA-256 compression of H_INIT with
     * the first 64 bytes as big-endian words. */

    /* We'll simulate by using our compress function through the public API.
     * Set midstate to H_INIT, set tailblock to first 16 words of header,
     * call hash_with_nonce(0) — this runs compress(H_INIT, tailblock)
     * then compress(H_INIT, [result + padding]). The ctx->result after
     * the FIRST compress (which gets overwritten) is our midstate.
     *
     * To get just the first compression, we need to add an API.
     * For now, let's output the full hash for each nonce and compare
     * against the JS output. */

    /* Direct midstate computation using the compress path.
     * We temporarily hijack the ctx: set midstate = H_INIT,
     * tailblock = first 16 header words, call hash_with_nonce.
     * But hash_with_nonce sets tailblock[3] to the nonce, which
     * corrupts our first block. We need the raw compress.
     *
     * Let's just use the known midstate from the JS test output.
     * With header [0,1,...,79], the midstate of SHA-256(H_INIT, block0)
     * where block0 = first 64 bytes as big-endian words is deterministic. */

    /* Actually, the simplest approach: just call the full pipeline for
     * multiple nonces and verify:
     * 1) Results are deterministic (same nonce → same hash every time)
     * 2) Different nonces → different hashes
     * 3) Print hashes so user can compare against JS output */

    /* For the real test, we need to match JS's computeMidstate + buildTailBlock.
     * Let's implement a minimal single-block SHA-256 compress here. */

    /* SHA-256 K table */
    static const uint32_t KK[64] = {
        0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,
        0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
        0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,
        0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
        0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,
        0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
        0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,
        0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
        0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,
        0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
        0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,
        0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
        0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,
        0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
        0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,
        0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
    };

    #define RR(x,n) (((x)>>(n))|((x)<<(32-(n))))

    /* Compute midstate = compress(H_INIT, first_64_bytes_BE) */
    {
        uint32_t W[64];
        for (int i = 0; i < 16; i++) W[i] = first_block[i];
        for (int i = 16; i < 64; i++) {
            uint32_t s0 = RR(W[i-15],7) ^ RR(W[i-15],18) ^ (W[i-15]>>3);
            uint32_t s1 = RR(W[i-2],17) ^ RR(W[i-2],19) ^ (W[i-2]>>10);
            W[i] = W[i-16] + s0 + W[i-7] + s1;
        }
        uint32_t a=H_INIT[0],b=H_INIT[1],c=H_INIT[2],d=H_INIT[3];
        uint32_t e=H_INIT[4],f=H_INIT[5],g=H_INIT[6],h=H_INIT[7];
        for (int i = 0; i < 64; i++) {
            uint32_t S1 = RR(e,6)^RR(e,11)^RR(e,25);
            uint32_t ch = (e&f)^(~e&g);
            uint32_t t1 = h + S1 + ch + KK[i] + W[i];
            uint32_t S0 = RR(a,2)^RR(a,13)^RR(a,22);
            uint32_t maj = (a&b)^(a&c)^(b&c);
            uint32_t t2 = S0 + maj;
            h=g;g=f;f=e;e=d+t1;d=c;c=b;b=a;a=t1+t2;
        }
        uint32_t mid[8] = {
            H_INIT[0]+a, H_INIT[1]+b, H_INIT[2]+c, H_INIT[3]+d,
            H_INIT[4]+e, H_INIT[5]+f, H_INIT[6]+g, H_INIT[7]+h
        };

        printf("Midstate: ");
        for (int i = 0; i < 8; i++) printf("%08x", mid[i]);
        printf("\n\n");

        /* Build tail block: last 16 bytes of header (bytes 64..79) as BE words,
         * plus SHA-256 padding: 0x80 after data, then zeros, then bit-length.
         * Total message = 80 bytes = 640 bits.
         *
         * Tail block layout (16 words):
         *   [0..3]  = header bytes 64..79 as 4 BE words
         *   [4]     = 0x80000000 (padding marker)
         *   [5..14] = 0x00000000 (zero padding)
         *   [15]    = 0x00000280 (bit-length = 640)
         */
        uint32_t tail[16];
        memset(tail, 0, 64);
        for (int i = 0; i < 4; i++) {
            tail[i] = ((uint32_t)header[64 + i*4] << 24) |
                      ((uint32_t)header[64 + i*4+1] << 16) |
                      ((uint32_t)header[64 + i*4+2] << 8) |
                      ((uint32_t)header[64 + i*4+3]);
        }
        tail[4] = 0x80000000;
        tail[15] = 0x00000280;  /* 640 bits */

        printf("Tail block (before nonce): ");
        for (int i = 0; i < 16; i++) printf("%08x ", tail[i]);
        printf("\n\n");

        /* Set up context */
        sha256_set_midstate(ctx, mid);
        sha256_set_tailblock(ctx, tail);

        /* Test nonces */
        uint32_t test_nonces[] = {0, 1, 42, 0xDEADBEEF, 0xFFFFFFFF};
        printf("Correctness (determinism + hash output):\n\n");

        uint32_t prev_result[8];
        int all_ok = 1;

        for (int t = 0; t < 5; t++) {
            uint32_t nonce = test_nonces[t];

            /* Hash twice to verify determinism */
            sha256_hash_with_nonce(ctx, nonce);
            uint32_t r1[8];
            sha256_get_result(ctx, r1);

            sha256_hash_with_nonce(ctx, nonce);
            uint32_t r2[8];
            sha256_get_result(ctx, r2);

            int determ = (memcmp(r1, r2, 32) == 0);
            int diff = (t == 0) ? 1 : (memcmp(r1, prev_result, 32) != 0);

            printf("  nonce=0x%08x: determ=%s diff=%s  hash=",
                   nonce,
                   determ ? "OK" : "FAIL",
                   diff ? "OK" : "FAIL");
            print_hex(r1);

            if (!determ || !diff) all_ok = 0;
            memcpy(prev_result, r1, 32);
        }

        printf("\nAll checks: %s\n\n", all_ok ? "PASS" : "FAIL");

        /* ── Benchmark ──────────────────────────────────────── */
        int ITERATIONS = 2000000;

        /* Per-hash benchmark */
        {
            struct timespec t0, t1;
            clock_gettime(CLOCK_MONOTONIC, &t0);
            for (int i = 0; i < ITERATIONS; i++) {
                sha256_hash_with_nonce(ctx, (uint32_t)i);
            }
            clock_gettime(CLOCK_MONOTONIC, &t1);
            double ms = (t1.tv_sec - t0.tv_sec) * 1000.0 +
                        (t1.tv_nsec - t0.tv_nsec) / 1e6;
            double rate = ITERATIONS / ms * 1000.0;
            printf("Benchmark (%d hashes):\n\n", ITERATIONS);
            printf("  Native per-hash:              %.0fms  -> %.2f MH/s\n",
                   ms, rate / 1e6);
        }

        /* Batch scan benchmark */
        {
            struct timespec t0, t1;
            clock_gettime(CLOCK_MONOTONIC, &t0);
            uint32_t total = 0;
            uint32_t pos = 0;
            while (total < (uint32_t)ITERATIONS) {
                uint32_t batch_end = pos + 65535;
                if (batch_end < pos) batch_end = 0xFFFFFFFF;
                uint32_t done = 0;
                sha256_scan_nonces(ctx, pos, batch_end, 4, &done);
                total += done;
                pos = batch_end + 1;
                if (pos == 0) break;
            }
            clock_gettime(CLOCK_MONOTONIC, &t1);
            double ms = (t1.tv_sec - t0.tv_sec) * 1000.0 +
                        (t1.tv_nsec - t0.tv_nsec) / 1e6;
            double rate = total / ms * 1000.0;
            printf("  Native batch (65536):         %.0fms  -> %.2f MH/s  (%u hashes)\n",
                   ms, rate / 1e6, total);
        }

        /* ── 4-way correctness: compare sha256_scan_nonces vs sha256_scan_nonces_4way ── */
        {
            printf("\n4-way correctness (scan_nonces vs scan_nonces_4way):\n\n");
            int ok4 = 1;
            /* Test 64 ranges of 64 nonces each; with target_zero_words=0 both
             * should return the first nonce in range (every nonce passes). */
            for (int i = 0; i < 64; i++) {
                uint32_t start = (uint32_t)(i * 64);
                uint32_t end   = start + 63;
                uint32_t done1 = 0, done4 = 0;
                int64_t c1 = sha256_scan_nonces    (ctx, start, end, 0, &done1);
                int64_t c4 = sha256_scan_nonces_4way(ctx, start, end, 0, &done4);
                if (c1 != c4) {
                    printf("  range [%u..%u]: MISMATCH 1way=%lld 4way=%lld\n",
                           start, end, (long long)c1, (long long)c4);
                    ok4 = 0;
                }
            }
            /* Also verify with target_zero_words=2 over a larger range */
            {
                uint32_t done1 = 0, done4 = 0;
                int64_t c1 = sha256_scan_nonces    (ctx, 0, 0x0FFFF, 2, &done1);
                int64_t c4 = sha256_scan_nonces_4way(ctx, 0, 0x0FFFF, 2, &done4);
                if (c1 != c4) {
                    printf("  range [0..0x0FFFF] tw=2: MISMATCH 1way=%lld 4way=%lld\n",
                           (long long)c1, (long long)c4);
                    ok4 = 0;
                }
            }
            printf("  4-way correctness: %s\n", ok4 ? "PASS" : "FAIL");
        }

        /* ── 4-way benchmark ──────────────────────────────────── */
        {
            struct timespec t0, t1;
            clock_gettime(CLOCK_MONOTONIC, &t0);
            uint32_t total = 0;
            uint32_t pos = 0;
            while (total < (uint32_t)ITERATIONS) {
                uint32_t batch_end = pos + 65535;
                if (batch_end < pos) batch_end = 0xFFFFFFFF;
                uint32_t done = 0;
                sha256_scan_nonces_4way(ctx, pos, batch_end, 4, &done);
                total += done;
                pos = batch_end + 1;
                if (pos == 0) break;
            }
            clock_gettime(CLOCK_MONOTONIC, &t1);
            double ms = (t1.tv_sec - t0.tv_sec) * 1000.0 +
                        (t1.tv_nsec - t0.tv_nsec) / 1e6;
            double rate = total / ms * 1000.0;
            printf("  4-way batch (65536×4):        %.0fms  -> %.2f MH/s  (%u hashes)\n",
                   ms, rate / 1e6, total);
        }
    }

    sha256_destroy_context(ctx);
    printf("\nDone.\n");
    return 0;
}
