/*\
title: $:/plugins/tiddlywiki/editor/structural-selection/structural-selection.js
type: application/javascript
module-type: editor-plugin

Expand/shrink selection by semantic units (word, markup, line, section).

Plugin Metadata:
- name: structural-selection
- configTiddler: $:/config/Editor/EnableStructuralSelection
- defaultEnabled: true

\*/
"use strict";

// ==================== PLUGIN METADATA ====================
exports.name = "structural-selection";
exports.configTiddler = "$:/config/Editor/EnableStructuralSelection";
exports.defaultEnabled = true;
exports.description = "Expand/shrink selection by semantic units (word, markup, line, section)";
exports.category = "editing";

// ==================== PLUGIN IMPLEMENTATION ====================
exports.create = function(engine) { return new StructuralSelectionPlugin(engine); };

function StructuralSelectionPlugin(engine) {
	this.engine = engine;
	this.name = "structural-selection";
	this.enabled = false;
	this.stack = []; // per-focus selection expansion stack

	this.hooks = {
		beforeKeydown: this.onKeydown.bind(this),
		focus: this.onFocus.bind(this),
		blur: this.onBlur.bind(this)
	};
}

StructuralSelectionPlugin.prototype.enable = function() { this.enabled = true; };
StructuralSelectionPlugin.prototype.disable = function() { this.enabled = false; this.stack = []; };

StructuralSelectionPlugin.prototype.onFocus = function() { this.stack = []; };
StructuralSelectionPlugin.prototype.onBlur = function() { this.stack = []; };

StructuralSelectionPlugin.prototype.onKeydown = function(event) {
	if(!this.enabled) return;
	var ctrl = event.ctrlKey || event.metaKey;
	if(ctrl) return;

	if(event.altKey && event.shiftKey && event.key === "ArrowUp") {
		event.preventDefault();
		this.expand();
		return false;
	}
	if(event.altKey && event.shiftKey && event.key === "ArrowDown") {
		event.preventDefault();
		this.shrink();
		return false;
	}
};

StructuralSelectionPlugin.prototype.getSel = function() {
	var ta = this.engine.domNode;
	return { start: ta.selectionStart, end: ta.selectionEnd };
};

StructuralSelectionPlugin.prototype.setSel = function(start, end) {
	var ta = this.engine.domNode;
	ta.selectionStart = start;
	ta.selectionEnd = end;
	this.engine.syncCursorFromDOM && this.engine.syncCursorFromDOM();
};

StructuralSelectionPlugin.prototype.expand = function() {
	var ta = this.engine.domNode;
	var text = ta.value;
	var cur = this.getSel();
	if(cur.start > cur.end) { var t=cur.start; cur.start=cur.end; cur.end=t; }

	// If stack top matches current selection, compute next; else reset stack
	if(this.stack.length === 0 || this.stack[this.stack.length-1].start !== cur.start || this.stack[this.stack.length-1].end !== cur.end) {
		this.stack = [cur];
	}

	var next = this.computeNextRange(text, cur.start, cur.end);
	if(!next) return;

	this.stack.push(next);
	this.setSel(next.start, next.end);
};

StructuralSelectionPlugin.prototype.shrink = function() {
	if(this.stack.length <= 1) return;
	this.stack.pop();
	var prev = this.stack[this.stack.length-1];
	this.setSel(prev.start, prev.end);
};

StructuralSelectionPlugin.prototype.computeNextRange = function(text, start, end) {
	// If caret: expand to word first
	if(start === end) {
		var w = this.wordRange(text, start);
		if(w) return w;
	}

	// Expand to smallest enclosing markup/token range
	var markup = this.enclosingMarkupRange(text, start, end);
	if(markup) return markup;

	// Expand to full lines
	var lineStart = text.lastIndexOf("\n", start - 1) + 1;
	var lineEnd = text.indexOf("\n", end);
	if(lineEnd === -1) lineEnd = text.length;
	else lineEnd += 1;
	if(lineStart !== start || lineEnd !== end) return { start: lineStart, end: lineEnd };

	// Expand to section by heading
	var sec = this.sectionRange(text, lineStart);
	if(sec && (sec.start !== start || sec.end !== end)) return sec;

	// Finally whole doc
	if(start !== 0 || end !== text.length) return { start: 0, end: text.length };
	return null;
};

StructuralSelectionPlugin.prototype.wordRange = function(text, pos) {
	var s = pos, e = pos;
	while(s > 0 && /\w/.test(text[s-1])) s--;
	while(e < text.length && /\w/.test(text[e])) e++;
	if(s === e) {
		// fallback: select non-whitespace chunk
		s = pos; e = pos;
		while(s > 0 && !/\s/.test(text[s-1])) s--;
		while(e < text.length && !/\s/.test(text[e])) e++;
	}
	return (s !== e) ? { start: s, end: e } : null;
};

StructuralSelectionPlugin.prototype.enclosingMarkupRange = function(text, start, end) {
	// Tokens: open/close pairs
	var pairs = [
		{ o:"[[", c:"]]" },
		{ o:"{{", c:"}}" },
		{ o:"<<", c:">>" },
		{ o:"''", c:"''" },
		{ o:"//", c:"//" },
		{ o:"__", c:"__" },
		{ o:"~~", c:"~~" },
		{ o:"^^", c:"^^" },
		{ o:",,", c:",," },
		{ o:"`",  c:"`" }
	];

	var best = null;
	for(var i=0;i<pairs.length;i++) {
		var r = this.findEnclosingPair(text, start, end, pairs[i].o, pairs[i].c);
		if(r && (!best || (r.end-r.start) < (best.end-best.start))) best = r;
	}
	return best;
};

StructuralSelectionPlugin.prototype.findEnclosingPair = function(text, start, end, open, close) {
	// naive but safe: search outward for nearest open before start and matching close after end
	var openPos = text.lastIndexOf(open, start);
	if(openPos === -1) return null;

	// Avoid picking an open that is actually after a closer when tokens are symmetric
	var closePos = text.indexOf(close, Math.max(end, openPos + open.length));
	if(closePos === -1) return null;

	// Must actually enclose selection
	var innerStart = openPos + open.length;
	var innerEnd = closePos;
	if(innerStart <= start && innerEnd >= end) {
		return { start: openPos, end: closePos + close.length };
	}
	return null;
};

StructuralSelectionPlugin.prototype.sectionRange = function(text, fromPos) {
	// Find heading line start above
	var lines = text.split("\n");
	var pos=0, lineIndex=0;
	for(; lineIndex<lines.length; lineIndex++) {
		var nextPos = pos + lines[lineIndex].length + 1;
		if(fromPos < nextPos) break;
		pos = nextPos;
	}

	// walk up to find a heading
	var headLine = -1;
	for(var i=lineIndex; i>=0; i--) {
		if(/^!{1,6}\s/.test(lines[i])) { headLine = i; break; }
	}
	if(headLine === -1) return null;

	var level = (lines[headLine].match(/^!+/)[0] || "!").length;

	// section ends at next heading of same or higher level
	var endLine = lines.length;
	for(var j=headLine+1; j<lines.length; j++) {
		var m = lines[j].match(/^!{1,6}\s/);
		if(m) {
			var l = (m[0].match(/^!+/)[0] || "!").length;
			if(l <= level) { endLine = j; break; }
		}
	}

	// convert line range to char range
	var startPos=0;
	for(i=0;i<headLine;i++) startPos += lines[i].length + 1;
	var endPos=0;
	for(i=0;i<endLine;i++) endPos += lines[i].length + 1;
	if(endPos > 0) endPos -= 1; // last newline not always present
	return { start: startPos, end: Math.min(endPos, text.length) };
};