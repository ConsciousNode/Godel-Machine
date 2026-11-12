; Held-out 1 (Kehai): Fahrenheit to Celsius, integer, per element: (x - 32) * 5 / 9
start:
  INLEN r1
  LDI r0, 0
  LDI r7, 1
loop:
  CMPLT r2, r0, r1
  JZ r2, done
  IN r3, r0
  LDI r4, 32
  SUB r3, r3, r4
  LDI r5, 5
  MUL r3, r3, r5
  LDI r6, 9
  DIV r3, r3, r6
  OUT r3
  ADD r0, r0, r7
  JMP loop
done:
  HALT
