import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { checkDirectory, listDirectories } from "./directories";

let base = "";
let root = "";

beforeAll(() => {
  base = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), "sr-dirs-")));
  root = path.join(base, "Client");
  mkdirSync(path.join(root, "sub"), { recursive: true });
  mkdirSync(path.join(root, "..foo"));
  mkdirSync(path.join(base, "Client-old"));
  mkdirSync(path.join(base, "outside"));
  writeFileSync(path.join(root, "arquivo.txt"), "x");
  symlinkSync(path.join(base, "outside"), path.join(root, "link"), "junction");
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

const isAccepted = (dir: string) => checkDirectory(root, dir).ok;
// Os casos de caixa so existem onde o sistema de arquivos nao diferencia caixa (Windows, macOS padrao). No Linux a
// pasta escrita em maiusculas e outra pasta, que nao existe.
const isCaseInsensitiveFs = existsSync(os.tmpdir().toUpperCase()) && existsSync(os.tmpdir().toLowerCase());
const OUTSIDE = { ok: false, reason: "dirOutsideRoot" };

describe("checkDirectory", () => {
  it("aceita a raiz exata e descendentes", () => {
    expect(checkDirectory(root, root)).toEqual({ ok: true, real: root });
    expect(checkDirectory(root, path.join(root, "sub"))).toEqual({ ok: true, real: path.join(root, "sub") });
  });

  it.runIf(isCaseInsensitiveFs)("aceita a mesma pasta escrita com outra caixa e devolve o caminho real", () => {
    expect(checkDirectory(root, path.join(root, "sub").toUpperCase())).toEqual({ ok: true, real: path.join(root, "sub") });
  });

  it("rejeita pasta irma por prefixo", () => {
    expect(checkDirectory(root, path.join(base, "Client-old"))).toEqual(OUTSIDE);
  });

  it.runIf(isCaseInsensitiveFs)("rejeita pasta irma por prefixo escrita com outra caixa", () => {
    expect(checkDirectory(root, path.join(base, "CLIENT-OLD"))).toEqual(OUTSIDE);
  });

  it.runIf(process.platform !== "win32")("rejeita pasta do sistema no macOS e no Linux, mesmo com a raiz em /", () => {
    const SYSTEM = { ok: false, reason: "dirSystem" };
    expect(checkDirectory("/", "/usr")).toEqual(SYSTEM);
    expect(checkDirectory("/", "/etc")).toEqual(SYSTEM);
    if (process.platform === "darwin") expect(checkDirectory("/", "/System")).toEqual(SYSTEM);
    // O tmp do usuario (no macOS, /private/var/folders) continua valendo.
    expect(checkDirectory(base, base)).toEqual({ ok: true, real: base });
  });

  it("rejeita subir com .. sem normalizar antes", () => {
    expect(checkDirectory(root, `${root}${path.sep}..${path.sep}outside`)).toEqual(OUTSIDE);
  });

  it("rejeita junction dentro da raiz que aponta para fora", () => {
    expect(checkDirectory(root, path.join(root, "link"))).toEqual(OUTSIDE);
  });

  it("rejeita pasta com % no caminho, que o cmd expandiria como variavel", () => {
    const percentRoot = path.join(base, "cem%porcento");
    mkdirSync(percentRoot);
    expect(checkDirectory(percentRoot, percentRoot)).toEqual({ ok: false, reason: "dirUnsafeChars" });
  });

  it("aceita subpasta cujo nome comeca com dois pontos", () => {
    expect(isAccepted(path.join(root, "..foo"))).toBe(true);
  });

  it("rejeita inexistente, outro drive, arquivo, caminho relativo e pasta mae vazia", () => {
    expect(checkDirectory(root, path.join(root, "nao-existe"))).toEqual({ ok: false, reason: "dirNotFound" });
    expect(isAccepted("Z:\\inexistente")).toBe(false);
    expect(checkDirectory(root, path.join(root, "arquivo.txt"))).toEqual({ ok: false, reason: "dirNotDirectory" });
    expect(isAccepted("sub")).toBe(false);
    expect(checkDirectory("", root)).toEqual({ ok: false, reason: "dirRootMissing" });
  });
});

describe("listDirectories", () => {
  it("lista a raiz e as subpastas imediatas, sem ocultas e sem junction", () => {
    expect(listDirectories(root)).toEqual([root, path.join(root, "sub")]);
  });

  it("pasta mae vazia ou inexistente devolve lista vazia", () => {
    expect(listDirectories("")).toEqual([]);
    expect(listDirectories(path.join(base, "nada"))).toEqual([]);
  });
});
