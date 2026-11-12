; Held-out 5 (Kehai): double each element and clamp to at most 100, using a memory scratch cell
start:
  INLEN r1
  LDI r0, 0
  LDI r7, 1
  LDI r8, 2
  LDI r9, 100
  LDI r10, 500        ; scratch address
loop:
  CMPLT r2, r0, r1
  JZ r2, done
  IN r3, r0
  MUL r3, r3, r8
  STORE r10, r3
  LOAD r4, r10
  CMPLT r5, r9, r4
  JZ r5, keep
  MOV r4, r9
keep:
  OUT r4
  ADD r0, r0, r7
  JMP loop
done:
  HALT
