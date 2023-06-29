mov ax, [first]
mov bx, [second]
cmp ax, bx
jle less_equals
mov cx, 2
jmp exit
less_equals:
mov cx, 1
exit:
section .bss
first:
db 9
second:
db 2