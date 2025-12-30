/*\
title: $:/core/modules/editor/operations/text/wrap-lines.js
type: application/javascript
module-type: texteditoroperation

Text editor operation to wrap the selected lines with a prefix and suffix.
Supports multiple cursors/selections.

\*/

"use strict";

function getParams(event) {
	var p = (event && event.paramObject) ? event.paramObject : {};
	return {
		prefix: (p.prefix !== undefined && p.prefix !== null) ? String(p.prefix) : "",
		suffix: (p.suffix !== undefined && p.suffix !== null) ? String(p.suffix) : ""
	};
}

function findPrecedingLineBreak(text, pos) {
	// Use TW utility if available, otherwise implement
	if($tw.utils.findPrecedingLineBreak) {
		return $tw.utils.findPrecedingLineBreak(text, pos);
	}
	var idx = text.lastIndexOf("\n", pos - 1);
	return (idx === -1) ? 0 : idx + 1;
}

function findFollowingLineBreak(text, pos) {
	// Use TW utility if available, otherwise implement
	if($tw.utils.findFollowingLineBreak) {
		return $tw.utils.findFollowingLineBreak(text, pos);
	}
	var idx = text.indexOf("\n", pos);
	return (idx === -1) ? text.length : idx;
}

function endsWith(str, suffix) {
	if($tw.utils.endsWith) {
		return $tw.utils.endsWith(str, suffix);
	}
	return str.slice(-suffix.length) === suffix;
}

function startsWith(str, prefix) {
	if($tw.utils.startsWith) {
		return $tw.utils.startsWith(str, prefix);
	}
	return str.slice(0, prefix.length) === prefix;
}

function normalizeOp(op, sharedText) {
	op.text = (typeof op.text === "string") ? op.text : (sharedText || "");
	op.selStart = (op.selStart !== undefined && op.selStart !== null) ? op.selStart : 0;
	op.selEnd = (op.selEnd !== undefined && op.selEnd !== null) ? op.selEnd : op.selStart;
	if(op.selEnd < op.selStart) {
		var tmp = op.selStart;
		op.selStart = op.selEnd;
		op.selEnd = tmp;
	}
	op.selection = (typeof op.selection === "string") ? op.selection : op.text.substring(op.selStart, op.selEnd);
}

function processOperation(op, prefix, suffix, sharedText) {
	normalizeOp(op, sharedText);
	
	var text = op.text;
	var selStart = op.selStart;
	var selEnd = op.selEnd;
	
	// Check if already wrapped: prefix + "\n" before selection and "\n" + suffix after
	var textBefore = text.substring(0, selStart);
	var textAfter = text.substring(selEnd);
	
	var isWrapped = endsWith(textBefore, prefix + "\n") && startsWith(textAfter, "\n" + suffix);
	
	if(isWrapped) {
		// Remove existing wrapper
		// Cut selected text plus prefix and suffix
		op.cutStart = selStart - (prefix.length + 1);
		op.cutEnd = selEnd + suffix.length + 1;
		
		// Also cut the following newline (if there is any)
		if(text[op.cutEnd] === "\n") {
			op.cutEnd++;
		}
		
		// Replace with just the selection (unwrapped)
		op.replacement = text.substring(selStart, selEnd);
		
		// Select text that was in between prefix and suffix
		op.newSelStart = op.cutStart;
		op.newSelEnd = selEnd - (prefix.length + 1);
	} else {
		// Add wrapper
		// Cut just past the preceding line break, or the start of the text
		op.cutStart = findPrecedingLineBreak(text, selStart);
		
		// Cut to just past the following line break, or to the end of the text
		op.cutEnd = findFollowingLineBreak(text, selEnd);
		
		// Add the prefix and suffix around the lines
		var linesToWrap = text.substring(op.cutStart, op.cutEnd);
		op.replacement = prefix + "\n" + linesToWrap + "\n" + suffix + "\n";
		
		// Adjust selection to be within the wrapped content
		op.newSelStart = op.cutStart + prefix.length + 1;
		op.newSelEnd = op.newSelStart + (op.cutEnd - op.cutStart);
	}
}

exports["wrap-lines"] = function(event, operation) {
	var params = getParams(event);
	
	// Handle both array and single operation
	var ops = Array.isArray(operation) ? operation : [operation];
	
	// Get the text from the first operation (they all share the same text)
	var text = (ops[0] && ops[0].text) ? ops[0].text : "";
	
	for(var i = 0; i < ops.length; i++) {
		if(ops[i] && typeof ops[i] === "object") {
			processOperation(ops[i], params.prefix, params.suffix, text);
		}
	}
	
	// For backward compatibility with single operation (non-array) calls
	if(!Array.isArray(operation) && ops[0]) {
		operation.cutStart = ops[0].cutStart;
		operation.cutEnd = ops[0].cutEnd;
		operation.replacement = ops[0].replacement;
		operation.newSelStart = ops[0].newSelStart;
		operation.newSelEnd = ops[0].newSelEnd;
	}
};