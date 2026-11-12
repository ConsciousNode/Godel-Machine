; Held-out 2 (Kehai): input is triples (h, m, s); emit total seconds h*60*60 + m*60 + s
start:
  INLEN r1
  LDI r0, 0
  LDI r9, 60
  LDI r10, 60
  MUL r11, r9, r10     ; seconds per hour, written as 60*60
  LDI r12, 1
loop:
  CMPLT r2, r0, r1
  JZ r2, done
  IN r3, r0
  ADD r0, r0, r12
  IN r4, r0
  ADD r0, r0, r12
  IN r5, r0
  ADD r0, r0, r12
  MUL r6, r3, r11
  MUL r7, r4, r9
  ADD r6, r6, r7
  ADD r6, r6, r5
  OUT r6
  JMP loop
done:
  HALT
