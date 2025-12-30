/*\
title: $:/core/modules/editor/operations/text/prefix-lines.js
type: application/javascript
module-type: texteditoroperation

Text editor operation to prefix all selected lines
Supports multiple cursors/selections

\*/

"use strict";

function getParams(event) {
	var p = (event && event.paramObject) ? event.paramObject : {};
	return {
		prefix: (p.prefix !== undefined) ? String(p.prefix) : "",
		character: (p.character !== undefined) ? String(p.character) : ""
	};
}

function processOperation(op, params, sharedText) {
	// Normalize
	op.text = (typeof op.text === "string") ? op.text : (sharedText || "");
	op.selStart = op.selStart || 0;
	op.selEnd = op.selEnd || op.selStart;
	
	var text = op.text;
	var prefix = params.prefix || params.character || "";
	
	if(!prefix) return;
	
	// Find line boundaries
	var lineStart = text.lastIndexOf("\n", op.selStart - 1) + 1;
	var lineEnd = text.indexOf("\n", op.selEnd);
	if(lineEnd === -1) lineEnd = text.length;
	
	// Get selected lines
	var selectedText = text.substring(lineStart, lineEnd);
	var lines = selectedText.split("\n");
	
	// Check if all lines already have prefix (toggle behavior)
	var allHavePrefix = lines.every(function(line) {
		return line.startsWith(prefix);
	});
	
	var newLines;
	if(allHavePrefix) {
		// Remove prefix
		newLines = lines.map(function(line) {
			return line.substring(prefix.length);
		});
	} else {
		// Add prefix
		newLines = lines.map(function(line) {
			return prefix + line;
		});
	}
	
	var replacement = newLines.join("\n");
	var deltaPerLine = allHavePrefix ? -prefix.length : prefix.length;
	var totalDelta = deltaPerLine * lines.length;
	
	op.cutStart = lineStart;
	op.cutEnd = lineEnd;
	op.replacement = replacement;
	
	// Adjust selection
	var selStartLine = text.substring(lineStart, op.selStart).split("\n").length - 1;
	var selEndLine = text.substring(lineStart, op.selEnd).split("\n").length - 1;
	
	op.newSelStart = op.selStart + (deltaPerLine * (selStartLine + 1));
	op.newSelEnd = op.selEnd + (deltaPerLine * (selEndLine + 1));
	
	// Keep selection within bounds
	op.newSelStart = Math.max(lineStart, Math.min(op.newSelStart, lineStart + replacement.length));
	op.newSelEnd = Math.max(op.newSelStart, Math.min(op.newSelEnd, lineStart + replacement.length));
}

exports["prefix-lines"] = function(event, operation) {
	var params = getParams(event);
	var ops = Array.isArray(operation) ? operation : [operation];
	var text = (ops[0] && ops[0].text) ? ops[0].text : "";
	
	for(var i = 0; i < ops.length; i++) {
		if(ops[i] && typeof ops[i] === "object") {
			processOperation(ops[i], params, text);
		}
	}
};