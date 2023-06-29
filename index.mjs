import VM from './main.mjs';

const regsElement      =   document.getElementById('regs');
const flagsElement     =   document.getElementById('flags');
const dataElement      =   document.getElementById('data');
const stackElement     =   document.getElementById('stack');
const lineElement      =   document.getElementById('line');
const stopElement      =   document.getElementById('stop');
const runElement       =   document.getElementById('run');
const nextElement      =   document.getElementById('next');
const startElement     =   document.getElementById('start');
const codeElement      =   document.getElementById('code');
const cyclesElement    =   document.getElementById('cycles');
const toggleElement    =   document.getElementById('toggle');
const canvas           =   document.getElementById('output');
const resetBreakpoints =   document.getElementById('resetBreakpoints');
const useBreakpoints   =   document.getElementById('break');
const linesElement     =   document.getElementById('lines');
const ctx              =   canvas.getContext('2d');

const width = 80;
const height = 25;
const fontSize = 15;
const lineHeight = 10;
let breakpoints = {};
let id = null;
let running = false;
let stopped = false;

canvas.width = `${fontSize * (width + 2)}`;
canvas.height = `${fontSize * (height + 2)}`;

const resetCanvas = () => {    
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
};

const fillCanvas = text => {
    ctx.font = `${fontSize}px consolas`;
    ctx.fillStyle = 'white';

    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
            ctx.fillText(text[x + y * width], (x + 1) * fontSize, (y + 2) * fontSize);
};

const fillElementFromObject = (element, object) => {
    element.value = '';
    Object.keys(object).forEach(i => element.value += `${i} = ${object[i]}\n`);
};

const animateFrame = () => {
    if ((useBreakpoints.checked && breakpoints[VM.lineNumber()]) || stopped) {
        if (running) {
            running = false;
            stopped = true;
            setRunButton(true);
            clearInterval(id);
        } else running = true;
    }
    
    if (running) stopped = false;

    try {
        if (running && VM.execLine()) {
            running = false;
            stopElement.style.display =
                runElement.style.display =
                nextElement.style.display = 'none';
        } else {
            fillElementFromObject(regsElement, VM.regs);
            fillElementFromObject(flagsElement, VM.flags);
            updateDataElement();
            stackElement.value = VM.stack();
            lineElement.value = VM.lineNumber();
            codeElement.dispatchEvent(new Event('input'));
            resetCanvas();
            fillCanvas(VM.getText());
            return;
        }
    } catch (e) {
        alert('invalid code on line: ' + lineElement.value);
    };

    clearInterval(id);
};

const setRunButton = status => {
    stopElement.style.display = status ? 'none' : 'initial';
    runElement.style.display = status ? 'initial' : 'none';
};

const updateDataElement = () => dataElement.value = (toggleElement.checked ? VM.dataAsText : VM.data)();
const triggerCodeUpdate = () => codeElement.dispatchEvent(new Event('input'));
const toggleBreakpoint = line => line <= codeElement.value.split('\n').length && (breakpoints[line] = ~(breakpoints[line] | false)); // to be O(1)...
const triggerCodeUpdateNoBack = () => codeElement.dispatchEvent(new CustomEvent('input', {'detail': true}));

document.addEventListener('DOMContentLoaded', () => {

    stopElement.addEventListener('click', () => {
        clearInterval(id);
        setRunButton(true);
    });

    startElement.addEventListener('click', () => {
        regsElement.value =
            flagsElement.value =
            dataElement.value =
            stackElement.value = '';
        nextElement.style.display = 'initial';
        startElement.innerText = 'Restart';
        lineElement.value = 0;
        clearInterval(id);
        setRunButton(true);
        resetCanvas();
        triggerCodeUpdate();
        VM.initSegments(codeElement.value);
        running = true;
    });

    runElement.addEventListener('click', () => {
        id = setInterval(animateFrame, cyclesElement.value);
        setRunButton(false);
    });
    
    codeElement.addEventListener('input', e => {
        const line = parseInt(lineElement.value);
        const codeLines = codeElement.value.split('\n').length;
        if(!e.isTrusted && !e.detail) codeElement.scrollTop = (line - 1) * codeElement.scrollHeight / codeLines;

        linesElement.value = '';
        [...Array(codeLines).keys()].forEach(index => {
            if (index == line) linesElement.value += '-> ';
            if (breakpoints[index]) linesElement.value += 'X ';
            linesElement.value += index + '.\n';
        });

        linesElement.scrollTop = codeElement.scrollTop;
    });
    
    codeElement.addEventListener('drop', async e => {
        e.preventDefault();
        codeElement.style.backgroundColor = 'initial';
        codeElement.value = await e.dataTransfer.files[0].text();
        triggerCodeUpdate();
        startElement.dispatchEvent(new Event('click'));
    });

    codeElement.addEventListener('keydown', e => {
        if (e.key == 'Tab') {
            e.preventDefault();
            const start = codeElement.selectionStart;
            const end = codeElement.selectionEnd;
            codeElement.value = codeElement.value.substring(0, start) + '\t' + codeElement.value.substring(end);
            codeElement.selectionStart = codeElement.selectionEnd = start + 1;
            triggerCodeUpdate();
        }
    });
    
    linesElement.addEventListener('click', e => {
        toggleBreakpoint(Math.floor((e.clientY + linesElement.scrollTop - linesElement.offsetTop) / linesElement.style.lineHeight.slice(0, -2)));
        triggerCodeUpdateNoBack();
    });

    resetBreakpoints.addEventListener('click', () => {
        breakpoints = {};
        triggerCodeUpdateNoBack();
    });
    
    document.addEventListener('keydown', e => {
        if (e.ctrlKey && e.key.toLowerCase() == 's') {
            e.preventDefault();
            const link = document.createElement('a');
            link.href = 'data:x-application/text,' + escape(codeElement.value);
            link.download = 'download.asm';
            link.click();
        } else VM.updateLastKeyCode(e.key);
    });

    [...document.getElementsByTagName('textarea')].forEach(i => i.style.lineHeight = `${lineHeight}px`);
    resetCanvas();
    nextElement.addEventListener('click', animateFrame);
    codeElement.addEventListener('scroll', () => linesElement.scrollTop = codeElement.scrollTop);
    codeElement.addEventListener('dragenter', () => codeElement.style.backgroundColor = 'grey');
    codeElement.addEventListener('dragleave', () => codeElement.style.backgroundColor = 'initial');
    toggleElement.addEventListener('click', updateDataElement);
    document.getElementById('font-size').addEventListener('input', () => 
        [linesElement, codeElement].forEach(textarea => 
            textarea.style.fontSize =
                textarea.style.lineHeight = `${document.getElementById('font-size').value}px`
        )
    );
    triggerCodeUpdate();
});
