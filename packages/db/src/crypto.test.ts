import { describe, expect, it } from "vitest";
import { decryptField, encryptField, hashLast4, hashMatches } from "./crypto";

describe("field encryption", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encryptField("123-45-6789");
    const b = encryptField("123-45-6789");
    expect(a).not.toBe(b);
    expect(a).not.toContain("6789");
    expect(decryptField(a)).toBe("123-45-6789");
  });

  it("detects tampering", () => {
    const parts = encryptField("1985-04-12").split(".");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decryptField(parts.join("."))).toThrow();
  });

  it("salts last-4 hashes per company", () => {
    expect(hashLast4("co1", "1234")).not.toBe(hashLast4("co2", "1234"));
    expect(hashMatches(hashLast4("co1", "1234"), "co1", "1234")).toBe(true);
    expect(hashMatches(hashLast4("co1", "1234"), "co1", "4321")).toBe(false);
  });
});
