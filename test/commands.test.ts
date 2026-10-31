import { describe, expect, it } from "vitest";
import { COMMANDS, HELP, MENU_COMMANDS } from "../src/commands";

describe("COMMANDS", () => {
  it("指令名稱不重複", () => {
    const names = COMMANDS.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  // setMyCommands 的限制：名稱 1–32 個小寫英數或底線，說明 1–256 字，最多 100 個
  it("符合 Telegram 選單的格式限制", () => {
    expect(MENU_COMMANDS.length).toBeLessThanOrEqual(100);
    for (const { command, description } of MENU_COMMANDS) {
      expect(command).toMatch(/^[a-z0-9_]{1,32}$/);
      expect(description.length).toBeGreaterThan(0);
      expect(description.length).toBeLessThanOrEqual(256);
    }
  });
});

describe("HELP", () => {
  it("列出每個用法", () => {
    for (const line of COMMANDS.flatMap((c) => c.usage)) expect(HELP).toContain(line);
  });
});
