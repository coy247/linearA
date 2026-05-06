#!/bin/bash
# voynich/build.sh — Compile native SHA-256 library from voynich specification.
#
# Detects platform and CPU, compiles with maximum optimization.
# On macOS ARM64: uses -march=armv8-a+crypto -mtune=native to unlock
#   __ARM_FEATURE_SHA2 (required for hardware SHA256H/SHA256H2 intrinsics).
#   NOTE: Apple clang's -march=native does NOT set __ARM_FEATURE_SHA2 even
#   on M1/M2/M3 — the +crypto extension must be explicit. This was the root
#   cause of the software fallback despite hardware SHA2 being present.
# On macOS x86: uses -march=native -msha for SHA-NI if available.
# On Linux: uses -march=native -fPIC for shared library.
#
# Usage: cd voynich && ./build.sh

set -euo pipefail

OS=$(uname -s)
ARCH=$(uname -m)
CC=${CC:-cc}

echo "voynich build — native SHA-256 library"
echo "  OS:   $OS"
echo "  ARCH: $ARCH"
echo "  CC:   $CC"
echo ""

CFLAGS="-O3 -Wall -Wextra"

case "$OS" in
  Darwin)
    EXT="dylib"
    LDFLAGS="-shared -dynamiclib"
    if [ "$ARCH" = "arm64" ]; then
      # Apple clang does not set __ARM_FEATURE_SHA2 via -march=native alone.
      # -march=armv8-a+crypto explicitly enables SHA256H/SHA256H2 intrinsics.
      # -mtune=native preserves M-series micro-architecture scheduling.
      CFLAGS="$CFLAGS -march=armv8-a+crypto -mtune=native"
      echo "  Target: macOS ARM64 — ARM SHA2 hardware intrinsics enabled"
      echo "  Flags:  -march=armv8-a+crypto -mtune=native"
    else
      CFLAGS="$CFLAGS -march=native"
      echo "  Target: macOS x86_64"
      if $CC -msha -E - < /dev/null > /dev/null 2>&1; then
        CFLAGS="$CFLAGS -msha"
        echo "  SHA-NI: enabled"
      else
        echo "  SHA-NI: not available"
      fi
    fi
    ;;
  Linux)
    EXT="so"
    LDFLAGS="-shared -fPIC"
    if [ "$ARCH" = "aarch64" ] || [ "$ARCH" = "arm64" ]; then
      CFLAGS="$CFLAGS -march=armv8-a+crypto -mtune=native"
      echo "  Target: Linux ARM64 — ARM SHA2 hardware intrinsics enabled"
    else
      CFLAGS="$CFLAGS -march=native"
      echo "  Target: Linux $ARCH"
      if $CC -msha -E - < /dev/null > /dev/null 2>&1; then
        CFLAGS="$CFLAGS -msha"
        echo "  SHA-NI: enabled"
      fi
    fi
    ;;
  *)
    echo "  Unsupported OS: $OS"
    exit 1
    ;;
esac

OUT="libsha256.$EXT"

echo ""
echo "  Compiling: $CC $CFLAGS $LDFLAGS sha256_native.c -o $OUT"
$CC $CFLAGS $LDFLAGS sha256_native.c -o "$OUT"

echo "  Output: $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes)"
echo ""

# Build test binary
echo "  Compiling test: $CC $CFLAGS test_native.c sha256_native.c -o test_native"
$CC $CFLAGS test_native.c sha256_native.c -o test_native
echo "  Test binary: test_native"
echo ""

# Build miner_core subprocess (the production mining engine)
echo "  Compiling miner_core: $CC $CFLAGS -pthread miner_core.c sha256_native.c -o miner_core"
$CC $CFLAGS -pthread miner_core.c sha256_native.c -o miner_core
echo "  Miner core: miner_core ($(wc -c < "miner_core" | tr -d ' ') bytes)"
echo ""

echo "Done."
echo "  Verify:     ./test_native"
echo "  Production: the miner auto-detects miner_core and uses native subprocess."
