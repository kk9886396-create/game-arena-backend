"use strict";
const entries = [];
const LIMIT = 100;

function add(event) {
const safeEvent = String(event)
.replace(/[^a-zA-Z0-9 _:\-|]/g, "")
.slice(0, 160);

entries.push({
time: new Date().toISOString(),
event: safeEvent
});

if (entries.length > LIMIT) entries.shift();
}

function recent() {
return entries.slice().reverse();
}

module.exports = { add, recent };
