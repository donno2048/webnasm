let lineNumber = 0;
let dataIndex = 0;
let lastKeyCode = 0;
let dataGarbage = 0;
const VGA_TEXT = new Array(2000).fill(0);
const VGA_COLOR = new Array(2000).fill(0); // TODO: implement
const DATA = new Array(1<<9).fill(0);
const codeseg = [];
const stack = [];
const labels = {};
const dataLabels = {};
const regs = {
    ax: 0,
    bx: 0,
    cx: 0,
    dx: 0,
    es: 0,
    di: 0,
    bp: 0,
    ds: 0,
    si: 0,
    ss: 0,
};
const flags = {
    zf: false,
    cf: false,
    df: false,
};

const conditions = (flags) => ({
    e: flags.zf,
    ne: !flags.zf,
    l: flags.cf,
    g: !flags.cf && !flags.zf,
    le: flags.cf || flags.zf,
    ge: !flags.cf,
    xcz: regs.cx == 0,
    mp: true,
});

const reset = () => {
    lineNumber = 0;
    dataIndex = 0;
    dataGarbage = 0;
    VGA_TEXT.fill(0);
    VGA_COLOR.fill(0);
    DATA.fill(0);
    codeseg.length = 0;
    stack.length = 0;
    Object.keys(labels).forEach(label => delete labels[label]);
    Object.keys(dataLabels).forEach(label => delete dataLabels[label]);
    Object.keys(regs).forEach(reg => regs[reg] = 0);
    Object.keys(flags).forEach(flag => flags[flag] = false);
};

// const writeByte = (byte, index, color = null) => (VGA_TEXT[index] = byte) && (VGA_COLOR[index] = color ?? VGA_COLOR[index]);
// const setData = (src, dst) => VGA_TEXT[dst] = DATA[src];
const initCodeSegment = data => reset() || splitToLines(data).map(stripComment).forEach((line, index) => codeseg.push(line) && line.endsWith(':') && addLabel(line.split(':')[0], index));
const getDataLines = data => splitToLines(data.split('section .bss')[1]);
const initDataSegment = data => {
    getDataLines(data).forEach(
        (line, index) => {
            if (!line.startsWith(';')) {
                if (line.endsWith(':'))
                    addDataLabel(line, index);
                else {
                    const element = line.replace(/^d+/, '');
                    if (/^[\'\"]/.test(element.split(' ')[1])) {
                        dataGarbage++;

                        for(const char of eval(element.split(' ').slice(1).join(' '))){
                            DATA[dataIndex++] = char;
                            dataGarbage--;
                        }
                    } else switch(element[0]) {
                        case 'b':
                            DATA[dataIndex++] = parseByteFromOperand(element.split(' ')[1] % 256);
                            break;
                        case 'w':
                            DATA[dataIndex++] = parseByteFromOperand(element.split(' ')[1] % 256);
                            DATA[dataIndex++] = parseByteFromOperand((element.split(' ')[1] >> 8) % 256);
                            break;
                        case ' ':
                            DATA[dataIndex++] = parseByteFromOperand(element.split(' ')[1] % 256);
                            DATA[dataIndex++] = parseByteFromOperand((element.split(' ')[1] >> 8) % 256);
                            DATA[dataIndex++] = parseByteFromOperand((element.split(' ')[1] >> 16) % 256);
                            DATA[dataIndex++] = parseByteFromOperand((element.split(' ')[1] >> 24) % 256);
                            break;
                    }
                }
            } else dataGarbage++;
        }
    );
};
const updateLastKeyCode = code => lastKeyCode = code;
const getVGA = byte => VGA_TEXT[(regs.es % 0x0B800) + regs.di / (byte ? 2 : 1)];
const getMainRegister = reg => reg.replace('l', 'x').replace('h', 'x');
const setLowRegister = (reg, value) => regs[reg] = ((regs[reg] >> 8) << 8) + value % 256;
const getLowRegister = reg => regs[reg] % 256;
const setHighRegister = (reg, value) => regs[reg] = regs[reg] % 256 + (value << 8) % (1<<0x10);
const getHighRegister = reg => regs[reg] >> 8;
const getRegister = reg => Object.keys(regs).includes(reg) ? regs[reg] :
    reg.endsWith('l') ? getLowRegister(getMainRegister(reg)) : getHighRegister(getMainRegister(reg));
const setRegister = (reg, value) => Object.keys(regs).includes(reg) ? regs[reg] = value % (1<<0x10) :
    reg.endsWith('l') ? setLowRegister(getMainRegister(reg), value) : setHighRegister(getMainRegister(reg), value);
const popToRegister = reg => setRegister(reg, stack.pop());
const pushToStack = byte => stack.push(byte);
const stripComment = line => line.split(';')[0];
const splitToLines = code => code.split('\n');
const splitLine = line => line.trim().split(' ');
const getInstruction = line => splitLine(line)[0];
const getOperands = line => splitLine(line).slice(1).join(' ').split(',').filter(i => i);
const isHex = operand => /0[xX][0-9a-fA-F]+/.test(operand);
const isNumeric = operand => /[0-9]+/.test(operand);
const isHex2 = operand => /[0-9a-fA-F]+h/.test(operand);
const isImmediate = operand => isHex(operand) || isNumeric(operand);
const registerOrImmediateFromOperand = operand => operand.replace(' ', '').includes('[es:di]') ? getVGA(operand.toLowerCase().includes('byte')) : isImmediate(operand) ? parseByteFromOperand(operand) : getRegister(operand.trim());
const parseByteFromOperand = operand => isHex2(operand) ? eval('0x' + operand.slice(0, -1).trim()) : eval(operand);
const normalizeLabel = label => label.split(':')[0].trim();
const addLabel = (label, index) => labels[normalizeLabel(label)] = index;
const addDataLabel = (label, index) => dataLabels[normalizeLabel(label)] = index - ++dataGarbage;
const executeLine = line => handleInstruction[getInstruction(line)](...getOperands(line));
const runLine = line => line.trim().startsWith('section .bss') ? lineNumber = codeseg.length : (line.endsWith(':') || executeLine(line));
const runLineWithIndex = line => runLine(stripComment(line), lineNumber++);
const copyValue = (copyTo, copyFrom) => pushToStack(copyFrom) && popToRegister(copyTo);
const call = position => pushToStack(lineNumber) && (lineNumber = labels[position]);
const input = (register, pos) => pos == 0x60 ? (pushToStack(getKeyboardInput(lastKeyCode)) && popToRegister(register)) : new Error('can only get keyboard input!');
const getKeyboardInput = keyCode => {
    return {
        'ArrowRight': 0x4D,
        'ArrowUp': 0x48,
        'ArrowDown': 0x50,
        'ArrowLeft': 0x4B,
    }[keyCode] || 0x50;
};
const push = operand => pushToStack(registerOrImmediateFromOperand(operand));
const inc = (register) => setRegister(register, getRegister(register) + 1);
const dec = (register) => setRegister(register, getRegister(register) - 1);
const neg = (register) => setRegister(register, -getRegister(register));
const ret = () => lineNumber = stack.pop() || lineNumber;
const pusha = () => Object.values(regs).forEach(pushToStack);
const popa = () => Object.keys(regs).reverse().forEach(popToRegister);
const jump = (label, condition) => conditions(flags)[condition] && (lineNumber = labels[label]);
const loop = label => --regs.cx && (lineNumber = labels[label]);
const set = (register, condition) => setRegister(register, conditions(flags)[condition] ? 1 : 0);
const mul = operand => regs.ax = (regs.ax * operand) % (1<<0x10);
const std = () => flags.df = true;
const cld = () => flags.df = false;
const rep = command => {while (regs.cx --> 0) runLine(command.trim());};
const div = operand => {
    regs.ax = operand != 0xFFFF ? Math.floor(regs.ax / operand) : Math.floor(Math.random() * 0xFFFF);
    regs.dx = regs.ax % operand;
};
const cmp = (x, y) => {
    flags.zf = x == y;
    flags.cf = x < y;
};
const parsePointer = pointer => {
    if (pointer.trim().includes('[es:di]')) return null;
    pointer = /^\[(.+)\]$/.exec(pointer.trim());
    if (!pointer) return null;
    pointer = pointer[1];
    pointer.split(/[+ -*]+/).forEach(element => {
        if (Object.keys(dataLabels).includes(element)) pointer = pointer.replace(element, dataLabels[element]);
        else if (Object.keys(regs).includes(element)) pointer = pointer.replace(element, regs[element]);
    });
    return parseByteFromOperand(pointer);
};
const operate = (operator, setFlag = false) => (copyTo, copyFrom) => {
    const copyToPointer = parsePointer(copyTo);
    const copyFromPointer = parsePointer(copyFrom);
    if (copyFromPointer != null) {
        if (copyToPointer != null) DATA[copyToPointer] = operator(DATA[copyToPointer], DATA[copyFromPointer]);
        else copyValue(copyTo, operator(getRegister(copyTo), DATA[copyFromPointer]));
    }
    else {
        const copyFromData = registerOrImmediateFromOperand(copyFrom);
        if (copyToPointer != null) DATA[copyToPointer] = operator(DATA[copyToPointer], copyFromData);
        else copyValue(copyTo, operator(getRegister(copyTo), copyFromData));
    }
    if (setFlag) flags.zf = (copyToPointer != null ? DATA[copyToPointer] : getRegister(copyTo)) == 0;
};
const lea = (copyTo, copyFrom) => {
    const copyFromPointer = parsePointer(copyFrom);
    if (copyFromPointer) copyValue(copyTo, copyFromPointer);
    else throw new Error('Error parsing lea');
};
// eslint-disable-next-line no-unused-vars
const movs = operand => {
    DATA[regs.es + regs.di] = DATA[regs.ds + regs.si];
    regs.si += flags.df ? -1 : 1;
    regs.di += flags.df ? -1 : 1;
};
const stos = operand => {
    const size = operand == 'w' ? 1 : 2;
    VGA_TEXT[(regs.es % 0x0B800) + regs.di / size] = getLowRegister('ax');
    regs.di += flags.df ? -1 : 1;
};
const int = interrupt => {
    if (parseByteFromOperand(interrupt) == 0x10 && getLowRegister('ax') == 3) {
        pushToStack(regs.ax);
        pushToStack(regs.cx);
        pushToStack(regs.di);
        pushToStack(0);
        pushToStack(0);
        pushToStack(0);
        pushToStack(2000);
        popToRegister('cx');
        popToRegister('di');
        popToRegister('es');
        popToRegister('ax');
        rep('stosw');
        popToRegister('di');
        popToRegister('cx');
        popToRegister('ax');
    } else throw new Error('Not yet implemented!');
};

const lodsb = () => {
    setLowRegister('ax', textToByte(DATA[regs.si]));
    regs.si += flags.df ? -1: 1;
};
const lodsw = () => {
    setLowRegister('ax', textToByte(DATA[regs.si++]));
    setHighRegister('ax', textToByte(DATA[regs.si]));
    regs.si += flags.df ? -3: 1;
};

const handleInstruction = {
    push: push,
    pop: popToRegister,
    mov: operate((_, a) => a),
    add: operate((a, b) => a + b),
    sub: operate((a, b) => a - b),
    and: operate((a, b) => a & b),
    or: operate((a, b) => a | b, true),
    xor: operate((a, b) => a ^ b),
    shr: operate((a, b) => a >> b),
    shl: operate((a, b) => a << b),
    lea: lea,
    call: call,
    ret: ret,
    neg: neg,
    inc: inc,
    dec: dec,
    pusha: pusha,
    popa: popa,
    std: std,
    cld: cld,
    rep: rep,
    int: int,
    loop: loop,
    lodsb: lodsb,
    lodsw: lodsw,
    movsb: () => movs('b'),
    movsw: () => movs('w'),
    stosb: () => stos('b'),
    stosw: () => stos('w'),
    je: operand => jump(operand, 'e'),
    jz: operand => jump(operand, 'e'),
    jne: operand => jump(operand, 'ne'),
    jnz: operand => jump(operand, 'ne'),
    jl: operand => jump(operand, 'l'),
    jc: operand => jump(operand, 'l'),
    jb: operand => jump(operand, 'l'),
    jnae: operand => jump(operand, 'l'),
    jnge: operand => jump(operand, 'l'),
    jg: operand => jump(operand, 'g'),
    ja: operand => jump(operand, 'g'),
    jnle: operand => jump(operand, 'g'),
    jnbe: operand => jump(operand, 'g'),
    jle: operand => jump(operand, 'le'),
    jbe: operand => jump(operand, 'le'),
    jna: operand => jump(operand, 'le'),
    jng: operand => jump(operand, 'le'),
    jge: operand => jump(operand, 'ge'),
    jae: operand => jump(operand, 'ge'),
    jnb: operand => jump(operand, 'ge'),
    jnl: operand => jump(operand, 'ge'),
    jnc: operand => jump(operand, 'ge'),
    jmp: operand => jump(operand, 'mp'),
    jxcz: operand => jump(operand, 'xcz'),
    sete: operand => set(operand, 'e'),
    setnz: operand => set(operand, 'nz'),
    setl: operand => set(operand, 'l'),
    setg: operand => set(operand, 'g'),
    setle: operand => set(operand, 'le'),
    setge: operand => set(operand, 'ge'),
    div: operand => div(registerOrImmediateFromOperand(operand)),
    mul: operand => mul(registerOrImmediateFromOperand(operand)),
    in: (op1, op2) => input(op1, registerOrImmediateFromOperand(op2)),
    cmp: (op1, op2) => cmp(registerOrImmediateFromOperand(op1), registerOrImmediateFromOperand(op2)),
    '': () => null,
};

const cp437 = '\
\u0000\u263a\u263b\u2665\u2666\u2663\u2660\u2022\u25d8\u25cb\u25d9\u2642\u2640\
\u266a\u266b\u263c\u25ba\u25c4\u2195\u203c\u00b6\u00a7\u25ac\u21a8\u2195\u2193\
\u2192\u2190\u221f\u2194\u25b2\u25bc\u0020\u0021\u0022\u0023\u0024\u0025\u0026\
\u0027\u0028\u0029\u002a\u002b\u002c\u002d\u002e\u002f\u0030\u0031\u0032\u0033\
\u0034\u0035\u0036\u0037\u0038\u0039\u003a\u003b\u003c\u003d\u003e\u003f\u0040\
\u0041\u0042\u0043\u0044\u0045\u0046\u0047\u0048\u0049\u004a\u004b\u004c\u004d\
\u004e\u004f\u0050\u0051\u0052\u0053\u0054\u0055\u0056\u0057\u0058\u0059\u005a\
\u005b\u005c\u005d\u005e\u005f\u0060\u0061\u0062\u0063\u0064\u0065\u0066\u0067\
\u0068\u0069\u006a\u006b\u006c\u006d\u006e\u006f\u0070\u0071\u0072\u0073\u0074\
\u0075\u0076\u0077\u0078\u0079\u007a\u007b\u007c\u007d\u007e\u2302\u00c7\u00fc\
\u00e9\u00e2\u00e4\u00e0\u00e5\u00e7\u00ea\u00eb\u00e8\u00ef\u00ee\u00ec\u00c4\
\u00c5\u00c9\u00e6\u00c6\u00f4\u00f6\u00f2\u00fb\u00f9\u00ff\u00d6\u00dc\u00a2\
\u00a3\u00a5\u20a7\u0192\u00e1\u00ed\u00f3\u00fa\u00f1\u00d1\u00aa\u00ba\u00bf\
\u2310\u00ac\u00bd\u00bc\u00a1\u00ab\u00bb\u2591\u2592\u2593\u2502\u2524\u2561\
\u2562\u2556\u2555\u2563\u2551\u2557\u255d\u255c\u255b\u2510\u2514\u2534\u252c\
\u251c\u2500\u253c\u255e\u255f\u255a\u2554\u2569\u2566\u2560\u2550\u256c\u2567\
\u2568\u2564\u2565\u2559\u2558\u2552\u2553\u256b\u256a\u2518\u250c\u2588\u2584\
\u258c\u2590\u2580\u03b1\u00df\u0393\u03c0\u03a3\u03c3\u00b5\u03c4\u03a6\u0398\
\u03a9\u03b4\u221e\u03c6\u03b5\u2229\u2261\u00b1\u2265\u2264\u2320\u2321\u00f7\
\u2248\u00b0\u2219\u00b7\u221a\u207f\u00b2\u25a0\u00a0';

const byteToText = byte => cp437.charAt(byte);
const textToByte = text => cp437.indexOf(text);

(() => {
    runLineWithIndex(';COMMENT');
    console.assert(true);

    runLineWithIndex('push 1');
    runLineWithIndex('pop ax');
    console.assert(regs.ax == 1);
    
    runLineWithIndex('push 0x100');
    runLineWithIndex('pop ax');
    console.assert(regs.ax == 0x100);

    runLineWithIndex('push 1');
    runLineWithIndex('pop al');
    console.assert(regs.ax == 0x101);
    
    runLineWithIndex('push 0x2');
    runLineWithIndex('pop ah');
    console.assert(regs.ax == 0x201);

    runLineWithIndex('mov di, ax');
    console.assert(regs.di == regs.ax);

    runLineWithIndex('mov bh, 0x3');
    console.assert(regs.bx == 0x3<<8);

    initCodeSegment('call start\nstart:\nmov bx, 0x12\nret');
    while(lineNumber < codeseg.length) runLine(codeseg[lineNumber], lineNumber++);
    console.assert(regs.bx == 0x12);

    runLineWithIndex('mov ax, 0x203');
    runLineWithIndex('and ax, 0x11');
    console.assert(regs.ax == 0x1);

    runLineWithIndex('mov ax, 0x202');
    runLineWithIndex('and al, 0x0');
    console.assert(regs.ax == 0x200);

    runLineWithIndex('cmp 0, 0');
    console.assert(!flags.cf && flags.zf);

    runLineWithIndex('cmp ax, 0x201');
    console.assert(!flags.zf && flags.cf);

    runLineWithIndex('cmp ax, al');
    console.assert(!flags.cf && !flags.zf);

    initCodeSegment('cmp 0, 0\nje f\nmov ax, 9\nf:\nmov bx, 9');
    while(lineNumber < codeseg.length) runLine(codeseg[lineNumber], lineNumber++);
    console.assert(regs.ax != 9 && regs.bx == 9);

    initCodeSegment('cmp 2, 0\nje f\nmov ax, 2\nf:');
    while(lineNumber < codeseg.length) runLine(codeseg[lineNumber], lineNumber++);
    console.assert(regs.ax == 2);

    initCodeSegment('cmp 2, 0\njge f\nmov ax, 5\nf:');
    while(lineNumber < codeseg.length) runLine(codeseg[lineNumber], lineNumber++);
    console.assert(regs.ax != 5);

    initCodeSegment('jmp f\nmov ax, 5\nf:');
    while(lineNumber < codeseg.length) runLine(codeseg[lineNumber], lineNumber++);
    console.assert(regs.ax != 5);

    runLineWithIndex('mov ax, 2');
    runLineWithIndex('or al, 5');
    console.assert(regs.ax == 7);

    runLineWithIndex('mov ax, 0x100');
    runLineWithIndex('shr ax, 4');
    console.assert(regs.ax == 0x100>>4);
    
    runLineWithIndex('mov ax, 2');
    runLineWithIndex('shl ax, 4');
    console.assert(regs.ax == 2<<4);

    runLineWithIndex('neg ax');
    console.assert(regs.ax == -2<<4);

    runLineWithIndex('mov ax, 0');
    runLineWithIndex('sub ax, 5');
    runLineWithIndex('add ax, 3');
    console.assert(regs.ax == -2);

    runLineWithIndex('inc ax');
    console.assert(regs.ax == -1);

    runLineWithIndex('dec ax');
    console.assert(regs.ax == -2);

    runLineWithIndex('mov ax, 0');
    runLineWithIndex('mov bx, 1');
    runLineWithIndex('mov cx, 2');
    runLineWithIndex('mov dx, 3');
    runLineWithIndex('pusha');
    runLineWithIndex('mov ax, 4');
    runLineWithIndex('mov bx, 5');
    runLineWithIndex('mov cx, 6');
    runLineWithIndex('mov dx, 7');
    runLineWithIndex('popa');
    console.assert(regs.ax == 0 && regs.bx == 1 && regs.cx == 2 && regs.dx == 3);

    runLineWithIndex('cmp 0, 0');
    runLineWithIndex('sete ax');
    console.assert(regs.ax == 1);

    runLineWithIndex('mul 10');
    console.assert(regs.ax == 10);

    runLineWithIndex('mov bx, 4');
    runLineWithIndex('div bx');
    console.assert(regs.ax == 2 && regs.dx == 2);

    initDataSegment('mov ax, bx\nsection .bss\ns:\ndb 7\n\ndw 0x708\ndd 0x101010');
    console.assert(DATA[0] == 7 && DATA[1] == 8 && DATA[2] == 7 && DATA[3] == 0x10 && DATA[4] == 0x10 && DATA[5] == 0x10 && DATA[6] == 0);

    VGA_TEXT[3] = 100;
    runLineWithIndex('mov es, 0');
    runLineWithIndex('mov di, 3');
    runLineWithIndex('mov ax, [es:di]');
    console.assert(regs.ax == 100);

    runLineWithIndex('std');
    console.assert(flags.df);
    runLineWithIndex('cld');
    console.assert(!flags.df);

    runLineWithIndex('mov cx, 3');
    runLineWithIndex('rep pusha');
    console.assert(stack.length == Object.keys(regs).length * 3);

    runLineWithIndex('mov cx, 3');
    runLineWithIndex('mov si, 0');
    runLineWithIndex('mov es, 10');
    runLineWithIndex('mov di, 0');
    runLineWithIndex('mov ds, 0');
    runLineWithIndex('cld');
    DATA[0] = 1;
    DATA[1] = 2;
    DATA[2] = 3;
    runLineWithIndex('rep movsb');
    console.assert(DATA[10] == 1 && DATA[11] == 2 && DATA[12] == 3);


    const code0 = 'mov bp, 3\nmov [a+2], 3\nmov [a+1], 2\nmov [a+0], 1\nlea cx, [bp+0x1]\nlea si, [a+bp]\nlea di, [si+0x2]\nstd\nrep movsb\ncld\nsection .bss\na:';
    initCodeSegment(code0);
    initDataSegment(code0);
    while(lineNumber < codeseg.length) runLine(codeseg[lineNumber], lineNumber++);
    console.assert(DATA[0] == 1 && DATA[1] == 2 && DATA[2] == 1 && DATA[3] == 2 && DATA[4] == 3);


    const code1 = 'mov [a+2], 3\nsection .bss\na:\ndb 2';
    initCodeSegment(code1);
    initDataSegment(code1);
    while(lineNumber < codeseg.length) runLine(codeseg[lineNumber], lineNumber++);
    console.assert(DATA[0] == 2 && DATA[1] == 0 && DATA[2] == 3);
    
    const code2 = 'mov ax, 5\nmov [a+1], ax\nsection .bss\na:';
    initCodeSegment(code2);
    initDataSegment(code2);
    while(lineNumber < codeseg.length) runLine(codeseg[lineNumber], lineNumber++);
    console.assert(DATA[0] == 0 && DATA[1] == 5);

    runLineWithIndex('mov di, 1');
    runLineWithIndex('mov ax, [a + di]');
    console.assert(regs.ax == 5);

    runLineWithIndex('mov ax, 4');
    runLineWithIndex('mov bx, 3');
    runLineWithIndex('lea di, [ax*bx]');
    console.assert(regs.di == 12);

    runLineWithIndex('mov di, 0');
    runLineWithIndex('mov es, 0');
    runLineWithIndex('mov al, 10');
    runLineWithIndex('stosb');
    console.assert(VGA_TEXT[0] == 10);

    const loopCode = 'mov cx, 3\nmov ax, 0\na:\ninc ax\nloop a\nsection .bss';
    initCodeSegment(loopCode);
    initDataSegment(loopCode);
    while(lineNumber < codeseg.length) runLine(codeseg[lineNumber], lineNumber++);
    console.assert(regs.ax == 3);

    const labelMovCode = 'mov ax, [a]\nsection .bss\na:\ndb 4';
    initCodeSegment(labelMovCode);
    initDataSegment(labelMovCode);
    while(lineNumber < codeseg.length) runLine(codeseg[lineNumber], lineNumber++);
    console.assert(regs.ax == 4);

    lineNumber = 0;
})();

export default {
    regs,
    flags,
    updateLastKeyCode,
    stack: () => stack.join(' '),
    getText: () => VGA_TEXT.map(byteToText).join(''),
    data: () => DATA.map(i => typeof(i) == 'number' ? i : textToByte(i)).map(i => i.toString(0x10).padStart(4, 0)).join('').match(/.{4}/g).join(' '),
    dataAsText: () => DATA.map(i => typeof(i) == 'number' ? [i % 256, Math.floor(i / 256)].map(byteToText).join('') : i).join('').replaceAll(' ', '\u00a0').replaceAll('\u0000', '\u2400'),
    lineNumber: () => lineNumber,
    execLine() {
        runLine(codeseg[lineNumber++]);
        return lineNumber >= codeseg.length;
    },
    initSegments(code) {
        code = code.toLowerCase(); // .split(/^([^;].*:)/gm).join('\n')
        if (!code.includes('section .bss')) code += '\nsection .bss';
        initCodeSegment(code);
        initDataSegment(code);
    },
};
