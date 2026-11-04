import test from "node:test";
import assert from "node:assert/strict";
import { toWhatsAppJid, normalizeSearch } from "./phone";

test("toWhatsAppJid: DDD local recebe 55", () => {
    assert.equal(toWhatsAppJid("6696876005"), "556696876005@s.whatsapp.net");
    assert.equal(toWhatsAppJid("(66) 99687-6005"), "5566996876005@s.whatsapp.net");
});

test("toWhatsAppJid: número já com 55 não duplica", () => {
    assert.equal(toWhatsAppJid("556696876005"), "556696876005@s.whatsapp.net");
    assert.equal(toWhatsAppJid("556696876005@s.whatsapp.net"), "556696876005@s.whatsapp.net");
});

test("toWhatsAppJid: zero inicial e formatação são limpos", () => {
    assert.equal(toWhatsAppJid("066 99687-6005"), "5566996876005@s.whatsapp.net");
});

test("toWhatsAppJid: grupo e outros JIDs passam intactos", () => {
    assert.equal(toWhatsAppJid("120363000000000000@g.us"), "120363000000000000@g.us");
    assert.equal(toWhatsAppJid("123@broadcast"), "123@broadcast");
});

test("normalizeSearch: acentos e caixa", () => {
    assert.equal(normalizeSearch("João"), "joao");
    assert.equal(normalizeSearch("  Conceição "), "conceicao");
    assert.equal(normalizeSearch(null), "");
});
