/*\
title: $:/core/modules/editor/operations/text/insert-text.js
type: application/javascript
module-type: texteditoroperation

Text editor operation to insert text at the caret position.
If there is a selection it is replaced.
Supports multiple cursors/selections.

\*/

"use strict";

function getParams(event) {
	var p = (event && event.paramObject) ? event.paramObject : {};
	return {
		text: (p.text !== undefined && p.text !== null) ? String(p.text) : ""
	};
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

function processOperation(op, insertText, sharedText) {
	normalizeOp(op, sharedText);
	
	op.replacement = insertText;
	op.cutStart = op.selStart;
	op.cutEnd = op.selEnd;
	
	// Cursor positioned at end of inserted text (not selecting it)
	op.newSelStart = op.selStart + insertText.length;
	op.newSelEnd = op.newSelStart;
}

exports["insert-text"] = function(event, operation) {
	var params = getParams(event);
	
	// Handle both array and single operation
	var ops = Array.isArray(operation) ? operation : [operation];
	
	// Get the text from the first operation (they all share the same text)
	var text = (ops[0] && ops[0].text) ? ops[0].text : "";
	
	for(var i = 0; i < ops.length; i++) {
		if(ops[i] && typeof ops[i] === "object") {
			processOperation(ops[i], params.text, text);
		}
	}
};