export type TuiComposerState = {
  promptLabel: string;
  inputBuffer?: string;
  inputCursor?: number;
  pendingTurn?: boolean;
  compactStatus: string;
  statusLine: string;
  followTail?: boolean;
  footerMode?: "default" | "shortcuts";
};

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;]*m/g, "");
}

function wrapPlainText(value: string, width: number): string[] {
  const plain = stripAnsi(value);
  if (width <= 1) {
    return [plain];
  }
  const paragraphs = plain.split("\n");
  const wrapped: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      wrapped.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= width) {
        current = candidate;
        continue;
      }
      if (current) {
        wrapped.push(current);
      }
      current = word.length <= width ? word : `${word.slice(0, Math.max(0, width - 1))}…`;
    }
    if (current) {
      wrapped.push(current);
    }
  }
  return wrapped.length > 0 ? wrapped : [""];
}

export function insertInputText(state: TuiComposerState, text: string): void {
  const buffer = state.inputBuffer ?? "";
  const cursor = Math.max(0, Math.min(state.inputCursor ?? buffer.length, buffer.length));
  state.inputBuffer = `${buffer.slice(0, cursor)}${text}${buffer.slice(cursor)}`;
  state.inputCursor = cursor + text.length;
}

export function deleteInputBackward(state: TuiComposerState): void {
  const buffer = state.inputBuffer ?? "";
  const cursor = Math.max(0, Math.min(state.inputCursor ?? buffer.length, buffer.length));
  if (cursor <= 0) {
    return;
  }
  state.inputBuffer = `${buffer.slice(0, cursor - 1)}${buffer.slice(cursor)}`;
  state.inputCursor = cursor - 1;
}

export function deleteInputWordBackward(state: TuiComposerState): void {
  const buffer = state.inputBuffer ?? "";
  const cursor = Math.max(0, Math.min(state.inputCursor ?? buffer.length, buffer.length));
  if (cursor <= 0) {
    return;
  }

  const trimmedPrefix = buffer.slice(0, cursor).replace(/\s+$/, "");
  const nextCursor = trimmedPrefix.replace(/[^\s]+$/, "").length;
  state.inputBuffer = `${buffer.slice(0, nextCursor)}${buffer.slice(cursor)}`;
  state.inputCursor = nextCursor;
}

export function moveInputCursor(state: TuiComposerState, delta: number): void {
  const buffer = state.inputBuffer ?? "";
  state.inputCursor = Math.max(0, Math.min((state.inputCursor ?? buffer.length) + delta, buffer.length));
}

export function clearInputBuffer(state: TuiComposerState): void {
  state.inputBuffer = "";
  state.inputCursor = 0;
}

export function replaceInputBuffer(state: TuiComposerState, value: string): void {
  state.inputBuffer = value;
  state.inputCursor = value.length;
}

export function buildInputLines(state: TuiComposerState, width: number): string[] {
  const buffer = state.inputBuffer ?? "";
  const cursor = Math.max(0, Math.min(state.inputCursor ?? buffer.length, buffer.length));
  const markedBuffer = `${buffer.slice(0, cursor)}|${buffer.slice(cursor)}`;
  const wrapped = markedBuffer
    .split("\n")
    .flatMap((line) => wrapPlainText(line || " ", Math.max(20, width - 4)));
  const prefix = state.pendingTurn ? `${state.promptLabel} [running]` : state.promptLabel;
  return wrapped.map((line, index) => (index === 0 ? `${prefix} ${line}` : `  ${line}`));
}
