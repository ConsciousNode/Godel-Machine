; Held-out 3 (Kehai): p(x) = 2x^2 + 3x + 7 per element, written term by term
start:
  INLEN r1
  LDI r0, 0
  LDI r8, 1
  LDI r9, 2
  LDI r10, 3
  LDI r11, 7
loop:
  CMPLT r2, r0, r1
  JZ r2, done
  IN r3, r0
  MUL r4, r3, r3
  MUL r4, r4, r9       ; 2x^2
  MUL r5, r3, r10      ; 3x
  ADD r4, r4, r5
  ADD r4, r4, r11
  OUT r4
  ADD r0, r0, r8
  JMP loop
done:
  HALT
