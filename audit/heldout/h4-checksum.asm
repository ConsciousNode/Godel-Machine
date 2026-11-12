; Held-out 4 (Kehai): rolling checksum s = (s * 31 + x) mod 1000003, emit final s
start:
  INLEN r1
  LDI r0, 0
  LDI r4, 0
  LDI r5, 31
  LDI r6, 1000003
  LDI r7, 1
loop:
  CMPLT r2, r0, r1
  JZ r2, done
  IN r3, r0
  MUL r4, r4, r5
  ADD r4, r4, r3
  MOD r4, r4, r6
  ADD r0, r0, r7
  JMP loop
done:
  OUT r4
  HALT
