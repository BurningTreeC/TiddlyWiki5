/*\
title: $:/plugins/tiddlywiki/editor/smart-pairs/smart-pairs.js
type: application/javascript
module-type: editor-plugin

Smart bracket and quote pairing plugin for the TiddlyWiki editor.
Automatically closes brackets, quotes, and wikitext markup.

Plugin Metadata:
- name: smart-pairs
- configTiddler: $:/config/Editor/EnableSmartPairs
- defaultEnabled: true

\*/

"use strict";

// ==================== PLUGIN METADATA ====================
// These exports are read by framed.js to build the plugin system

exports.name = "smart-pairs";
exports.configTiddler = "$:/config/Editor/EnableSmartPairs";
exports.configTiddlerAlt = "$:/config/EnableSmartPairs";  // Legacy fallback
exports.defaultEnabled = true;
exports.description = "Automatically close brackets, quotes, and wikitext markup";
exports.category = "editing";
exports.supports = { simple: true, framed: true };

// ==================== PLUGIN IMPLEMENTATION ====================

var PAIRS = {
	"(": ")",
	"[": "]",
	"{": "}",
	'"': '"',
	"'": "'",
	"`": "`",
	"<": ">"
};

var WIKITEXT_PAIRS = {
	"[[": "]]",
	"{{": "}}",
	"<<": ">>",
	"```": "```",
	"''": "''",
	"//": "//",
	"__": "__",
	"~~": "~~",
	"^^": "^^",
	",,": ",,"
};

var SYMMETRIC_TOKENS = {
	"```": true,
	"''": true,
	"//": true,
	"__": true,
	"~~": true,
	"^^": true,
	",,": true
};

var SKIP_CLOSE_CHARS = ['"', "'", "`", ")", "]", "}", ">"];

exports.create = function(engine) {
	return new SmartPairsPlugin(engine);
};

function SmartPairsPlugin(engine) {
	this.engine = engine;
	this.name = "smart-pairs";
	this.enabled = false;

	this.config = {
		enableBrackets: true,
		enableQuotes: true,
		enableWikitext: true,
		deletePairs: true
	};

	this.hooks = {
		beforeKeydown: this.handleKeydown.bind(this)
	};
}

SmartPairsPlugin.prototype.enable = function() {
	this.enabled = true;
};

SmartPairsPlugin.prototype.disable = function() {
	this.enabled = false;
};

SmartPairsPlugin.prototype.configure = function(options) {
	if(!options) return;
	if(options.enableBrackets !== undefined) this.config.enableBrackets = !!options.enableBrackets;
	if(options.enableQuotes !== undefined) this.config.enableQuotes = !!options.enableQuotes;
	if(options.enableWikitext !== undefined) this.config.enableWikitext = !!options.enableWikitext;
	if(options.deletePairs !== undefined) this.config.deletePairs = !!options.deletePairs;
};

SmartPairsPlugin.prototype.handleKeydown = function(event, data, engine) {
	if(!this.enabled) return;
	if(event.ctrlKey || event.metaKey || event.altKey) return;

	var ta = engine.domNode;
	if(!ta) return;

	var text = ta.value;
	var selStart = ta.selectionStart;
	var selEnd = ta.selectionEnd;
	var key = event.key;

	// Backspace: delete paired tokens
	if(key === "Backspace" && this.config.deletePairs) {
		if(this.handleBackspace(text, selStart, selEnd)) {
			event.preventDefault();
			return false;
		}
		return;
	}

	// Tab: jump over a closer
	if(key === "Tab" && !event.shiftKey) {
		if(this.handleTabJump(text, selStart, selEnd)) {
			event.preventDefault();
			return false;
		}
		return;
	}

	// If a wikitext token is involved, suppress single-char pairing for this keystroke
	var suppressSingleCharPairing = false;

	// ---------------- WIKITEXT ----------------
	if(this.config.enableWikitext && key.length === 1) {
		// Triple backtick: detect by looking 2 chars behind + key
		var twoBefore = text.substring(Math.max(0, selStart - 2), selStart);
		if(twoBefore + key === "```") {
			suppressSingleCharPairing = true;

			// If immediately ahead already has ``` (skip over)
			if(selStart === selEnd && text.substr(selStart, 3) === "```") {
				event.preventDefault();
				ta.selectionStart = selStart + 3;
				ta.selectionEnd = selStart + 3;
				engine.syncCursorFromDOM && engine.syncCursorFromDOM();
				return false;
			}

			// If we're closing an existing ``` context, allow default insertion but don't fall through
			if(this.isSymmetricClosingContext && this.isSymmetricClosingContext(text, selStart, "```")) {
				return;
			}

			event.preventDefault();
			// replaceLen=2 because two backticks already exist before caret
			this.insertPairViaEngine("```", "```", selStart, selEnd, 2);
			return false;
		}

		// Two-char tokens: look 1 char behind + key
		var oneBefore = text.substring(Math.max(0, selStart - 1), selStart);
		var token = oneBefore + key;
		var closeTok = WIKITEXT_PAIRS[token];

		if(closeTok) {
			suppressSingleCharPairing = true;

			// -------- SPECIAL UPGRADE: '' when single-char pairing already made "''"
			// Example: text contains "''" with caret between them, user types "'"
			if(token === "''" && selStart === selEnd) {
				if(selStart > 0 && text.substr(selStart - 1, 1) === "'" && text.substr(selStart, 1) === "'") {
					event.preventDefault();

					var cutStartQ = selStart - 1;
					var cutEndQ = Math.min(text.length, selStart + 1);

					engine.captureBeforeState && engine.captureBeforeState();

					ta.value = text.substring(0, cutStartQ) + "''''" + text.substring(cutEndQ);

					var caretQ = cutStartQ + 2; // middle of ''''
					ta.selectionStart = caretQ;
					ta.selectionEnd = caretQ;

					engine.syncCursorFromDOM && engine.syncCursorFromDOM();
					engine.recordUndo && engine.recordUndo(true);
					engine.saveChanges && engine.saveChanges();
					engine.fixHeight && engine.fixHeight();
					return false;
				}
			}

			// Symmetric tokens ('' // __ ~~ ^^ ,, ```): toggle-aware
			if(SYMMETRIC_TOKENS && SYMMETRIC_TOKENS[token]) {
				// If token exists immediately ahead, jump over it
				if(selStart === selEnd && text.substr(selStart, token.length) === token) {
					event.preventDefault();
					ta.selectionStart = selStart + token.length;
					ta.selectionEnd = selStart + token.length;
					engine.syncCursorFromDOM && engine.syncCursorFromDOM();
					return false;
				}

				// If context indicates we're closing, allow default insertion but don't fall through
				if(this.isSymmetricClosingContext && this.isSymmetricClosingContext(text, selStart, token)) {
					return;
				}
			}

			// Upgrade case for [[ {{ << when single-char pairing already made [] {} <>
			// Example: text="[]", caret between, user types second "["
			if((!SYMMETRIC_TOKENS || !SYMMETRIC_TOKENS[token]) && selStart === selEnd) {
				var singleClose = PAIRS[key]; // "["->"]", "{"->"}", "<"->">"
				if(singleClose && text.substr(selStart, 1) === singleClose) {
					event.preventDefault();

					// Replace the whole [] with [[]] (or {} -> {{}} etc.)
					var cutStart = Math.max(0, selStart - 1);
					var cutEnd = Math.min(text.length, selStart + 1);

					engine.captureBeforeState && engine.captureBeforeState();

					ta.value = text.substring(0, cutStart) + token + closeTok + text.substring(cutEnd);

					// Caret between opener and closer
					var caret = cutStart + token.length;
					ta.selectionStart = caret;
					ta.selectionEnd = caret;

					engine.syncCursorFromDOM && engine.syncCursorFromDOM();
					engine.recordUndo && engine.recordUndo(true);
					engine.saveChanges && engine.saveChanges();
					engine.fixHeight && engine.fixHeight();
					return false;
				}
			}

			// Normal 2-char token insertion
			event.preventDefault();
			// replaceLen=1 because first char already exists before caret
			this.insertPairViaEngine(token, closeTok, selStart, selEnd, 1);
			return false;
		}
	}

	// If a wikitext token was involved, do not run single-char pairing
	if(suppressSingleCharPairing) {
		return;
	}

	// ---------------- SINGLE CHAR PAIRS ----------------
	if(PAIRS[key]) {
		var closeChar = PAIRS[key];
		var charAfter = text.substring(selEnd, selEnd + 1);

		// Skip over existing closer
		if(selStart === selEnd && SKIP_CLOSE_CHARS.indexOf(key) !== -1 && charAfter === key) {
			event.preventDefault();
			ta.selectionStart = selEnd + 1;
			ta.selectionEnd = selEnd + 1;
			engine.syncCursorFromDOM && engine.syncCursorFromDOM();
			return false;
		}

		// Quotes: context-aware
		if((key === '"' || key === "'" || key === "`") && this.config.enableQuotes) {
			if(this.shouldAutoCloseQuote(text, selStart, key)) {
				event.preventDefault();
				this.insertPairViaEngine(key, closeChar, selStart, selEnd, 0);
				return false;
			}
		} else if(this.config.enableBrackets) {
			event.preventDefault();
			this.insertPairViaEngine(key, closeChar, selStart, selEnd, 0);
			return false;
		}
	}
};

// ---------- insertion (undo-safe + multi-cursor aware) ----------
SmartPairsPlugin.prototype.insertPairViaEngine = function(open, close, selStart, selEnd, replaceLen) {
	var engine = this.engine;
	var ta = engine.domNode;
	var text = ta.value;

	replaceLen = replaceLen || 0;

	// Multi-cursor path
	if(engine.hasMultipleCursors && engine.hasMultipleCursors() && engine.createTextOperation && engine.executeTextOperation) {
		var ops = engine.createTextOperation();
		for(var i = 0; i < ops.length; i++) {
			var op = ops[i];
			var cs = Math.max(0, op.selStart - replaceLen);
			var ce = op.selEnd;

			var middle = op.text.substring(op.selStart, op.selEnd);

			op.cutStart = cs;
			op.cutEnd = ce;
			op.replacement = open + middle + close;

			if(middle && middle.length > 0) {
				op.newSelStart = cs + open.length;
				op.newSelEnd = op.newSelStart + middle.length;
			} else {
				var p = cs + open.length;
				op.newSelStart = p;
				op.newSelEnd = p;
			}
		}
		engine.executeTextOperation(ops);
		engine.fixHeight && engine.fixHeight();
		return;
	}

	// Single cursor fallback
	engine.captureBeforeState && engine.captureBeforeState();

	var cutStart = Math.max(0, selStart - replaceLen);
	var before = text.substring(0, cutStart);
	var middleSingle = text.substring(selStart, selEnd);
	var after = text.substring(selEnd);

	ta.value = before + open + middleSingle + close + after;

	var caret = cutStart + open.length;
	if(middleSingle.length > 0) {
		ta.selectionStart = caret;
		ta.selectionEnd = caret + middleSingle.length;
	} else {
		ta.selectionStart = caret;
		ta.selectionEnd = caret;
	}

	engine.syncCursorFromDOM && engine.syncCursorFromDOM();
	engine.recordUndo && engine.recordUndo(true);
	engine.saveChanges && engine.saveChanges();
	engine.fixHeight && engine.fixHeight();
};

// ---------- backspace pair delete ----------
SmartPairsPlugin.prototype.handleBackspace = function(text, selStart, selEnd) {
	if(selStart !== selEnd) return false;
	if(selStart === 0) return false;

	var engine = this.engine;
	var ta = engine.domNode;

	var allPairs = Object.assign({}, PAIRS, WIKITEXT_PAIRS);

	for(var open in allPairs) {
		if(!Object.prototype.hasOwnProperty.call(allPairs, open)) continue;

		var close = allPairs[open];
		var openLen = open.length;
		var closeLen = close.length;

		var before = text.substring(selStart - openLen, selStart);
		var after = text.substring(selStart, selStart + closeLen);

		if(before === open && after === close) {
			engine.captureBeforeState && engine.captureBeforeState();

			ta.value = text.substring(0, selStart - openLen) + text.substring(selStart + closeLen);
			ta.selectionStart = selStart - openLen;
			ta.selectionEnd = selStart - openLen;

			engine.syncCursorFromDOM && engine.syncCursorFromDOM();
			engine.recordUndo && engine.recordUndo(true);
			engine.saveChanges && engine.saveChanges();
			engine.fixHeight && engine.fixHeight();
			return true;
		}
	}

	return false;
};

// ---------- tab jump ----------
SmartPairsPlugin.prototype.handleTabJump = function(text, selStart, selEnd) {
	if(selStart !== selEnd) return false;

	var closers = Object.values(PAIRS).concat(Object.values(WIKITEXT_PAIRS));
	var engine = this.engine;
	var ta = engine.domNode;

	for(var i = 0; i < closers.length; i++) {
		var c = closers[i];
		if(c && text.substr(selStart, c.length) === c) {
			ta.selectionStart = selStart + c.length;
			ta.selectionEnd = selStart + c.length;
			engine.syncCursorFromDOM && engine.syncCursorFromDOM();
			return true;
		}
	}
	return false;
};

// ---------- quote heuristic ----------
SmartPairsPlugin.prototype.shouldAutoCloseQuote = function(text, position, ch) {
	var before = text.substring(position - 1, position);
	if(/\w/.test(before)) return false;

	var after = text.substring(position, position + 1);
	if(/\w/.test(after)) return false;

	var lineStart = text.lastIndexOf("\n", position - 1) + 1;
	var lineBefore = text.substring(lineStart, position);

	var count = 0;
	for(var i = 0; i < lineBefore.length; i++) {
		if(lineBefore[i] === ch && (i === 0 || lineBefore[i - 1] !== "\\")) count++;
	}

	return (count % 2) === 0;
};

// ---------- symmetric token close context heuristic ----------
SmartPairsPlugin.prototype.isSymmetricClosingContext = function(text, selStart, token) {
	// Count full token occurrences on the current line BEFORE caret.
	// Odd count => we're inside an opener => typing token should close.
	var lineStart = text.lastIndexOf("\n", selStart - 1) + 1;
	var lineBefore = text.substring(lineStart, selStart);

	var count = 0;
	for(var i = 0; i <= lineBefore.length - token.length; i++) {
		if(lineBefore.substr(i, token.length) === token) {
			count++;
			i += token.length - 1;
		}
	}
	return (count % 2) === 1;
};

SmartPairsPlugin.prototype.destroy = function() {};