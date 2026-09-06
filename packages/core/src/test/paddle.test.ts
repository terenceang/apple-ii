import { describe, expect, it } from "vitest";
import { Memory } from "../memory/memory.js";
import { Paddle } from "../io/paddle.js";

describe("Paddle", () => {
  it("pushbuttons 0-2 report pressed state in bit7 at $C061-$C063", () => {
    const memory = new Memory();
    const paddle = new Paddle();
    paddle.attach(memory, () => 0);

    expect(memory.read(0xc061)).toBe(0);
    paddle.setButton(0, true);
    expect(memory.read(0xc061) & 0x80).toBeTruthy();
    expect(memory.read(0xc062) & 0x80).toBeFalsy(); // other buttons unaffected
    paddle.setButton(2, true);
    expect(memory.read(0xc063) & 0x80).toBeTruthy();
    paddle.setButton(0, false);
    expect(memory.read(0xc061)).toBe(0);
  });

  it("paddle timing: bit7 clears once elapsed cycles exceed value * 11 after $C070", () => {
    const memory = new Memory();
    let cycle = 0;
    const paddle = new Paddle();
    paddle.attach(memory, () => cycle);

    paddle.setValue(0, 10); // 10 units * 11 cycles/unit = 110 cycles
    memory.read(0xc070); // restart all RC timers at cycle 0

    cycle = 109;
    expect(memory.read(0xc064) & 0x80).toBeTruthy(); // still charging
    cycle = 110;
    expect(memory.read(0xc064)).toBe(0); // expired (elapsed >= value*11)

    // restart works from any later cycle
    cycle = 5000;
    memory.read(0xc070);
    cycle = 5001;
    expect(memory.read(0xc064) & 0x80).toBeTruthy();
  });

  it("each paddle times out independently; value 0 expires immediately", () => {
    const memory = new Memory();
    let cycle = 0;
    const paddle = new Paddle();
    paddle.attach(memory, () => cycle);

    paddle.setValue(0, 200);
    paddle.setValue(1, 0);
    memory.read(0xc070);

    expect(memory.read(0xc065)).toBe(0); // value 0 -> already expired
    expect(memory.read(0xc064) & 0x80).toBeTruthy(); // value 200 still charging
    cycle = 2200;
    expect(memory.read(0xc064)).toBe(0);
  });

  it("setValue clamps to 0-255", () => {
    const memory = new Memory();
    let cycle = 0;
    const paddle = new Paddle();
    paddle.attach(memory, () => cycle);

    paddle.setValue(2, 999); // clamps to 255 -> 255*11 = 2805 cycles
    memory.read(0xc070);
    cycle = 2804;
    expect(memory.read(0xc066) & 0x80).toBeTruthy();
    cycle = 2805;
    expect(memory.read(0xc066)).toBe(0);
  });
});
