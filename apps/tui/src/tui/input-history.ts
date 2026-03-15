export class InputHistory {
  private readonly entries: string[] = [];
  private index: number | undefined;

  push(value: string): void {
    if (!value.trim()) {
      return;
    }
    if (this.entries.at(-1) !== value) {
      this.entries.push(value);
    }
    this.index = undefined;
  }

  previous(): { value: string; label: string } | undefined {
    if (this.entries.length === 0) {
      return undefined;
    }
    this.index = this.index === undefined ? this.entries.length - 1 : Math.max(0, this.index - 1);
    return {
      value: this.entries[this.index] ?? "",
      label: `History ${this.index + 1}/${this.entries.length}`
    };
  }

  next(): { value: string; label: string } | { value: ""; label: "Ready for a new prompt" } | undefined {
    if (this.index === undefined) {
      return undefined;
    }
    this.index += 1;
    if (this.index >= this.entries.length) {
      this.index = undefined;
      return { value: "", label: "Ready for a new prompt" };
    }
    return {
      value: this.entries[this.index] ?? "",
      label: `History ${this.index + 1}/${this.entries.length}`
    };
  }
}
