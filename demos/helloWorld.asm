Start:
MOV SI, strOfs
MOV CX, [strLen]
MOV AX, 0B800h
MOV ES, AX
MOV DI, 10
CLD
nextChar:
LODSB
STOSB
INC DI
LOOP nextChar
section .bss
strOfs:
DB 'hello world'
strLen:
db 0xb