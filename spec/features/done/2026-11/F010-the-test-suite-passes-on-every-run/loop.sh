#!/bin/sh
# Runs `npx vitest run` N times in a row (default 50) and writes one line per run to $OUT.
# The full output of each failing run goes to $OUT.fail-<n>.log.
# Usage: sh spec/features/active/F010-the-test-suite-passes-on-every-run/loop.sh 50 /tmp/runs.log
n=${1:-50}
out=${2:-runs.log}
: > "$out"
pass=0
fail=0
i=1
while [ "$i" -le "$n" ]; do
  log=$(npx vitest run 2>&1)
  status=$?
  summary=$(printf '%s\n' "$log" | sed 's/\x1b\[[0-9;]*m//g' | grep -E '^ +Tests ' | sed 's/^ *//')
  if [ "$status" -eq 0 ]; then
    pass=$((pass + 1))
    echo "run $i: pass  $summary" >> "$out"
  else
    fail=$((fail + 1))
    echo "run $i: FAIL  $summary" >> "$out"
    printf '%s\n' "$log" > "$out.fail-$i.log"
  fi
  i=$((i + 1))
done
echo "total: $n runs, $pass passed, $fail failed" >> "$out"
tail -1 "$out"
