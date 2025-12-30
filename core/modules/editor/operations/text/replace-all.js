/*\
title: $:/core/modules/editor/operations/text/replace-all.js
type: application/javascript
module-type: texteditoroperation

Text editor operation to replace the entire text.
Note: This replaces the whole document, so multi-cursor state is reset.

\*/

"use strict";

function getParams(event) {
	var p = (event && event.paramObject) ? event.paramObject : {};
	return {
		text: (p.text !== undefined && p.text !== null) ? String(p.text) : "",
		select: p.select || "all"  // "all", "start", "end", "none"
	};
}

function normalizeOp(op, sharedText) {
	op.text = (typeof op.text === "string") ? op.text : (sharedText || "");
	op.selStart = (op.selStart !== undefined && op.selStart !== null) ? op.selStart : 0;
	op.selEnd = (op.selEnd !== undefined && op.selEnd !== null) ? op.selEnd : op.selStart;
}

exports["replace-all"] = function(event, operation) {
	var params = getParams(event);
	
	// Handle both array and single operation
	var ops = Array.isArray(operation) ? operation : [operation];
	
	// Get the text from the first operation
	var text = (ops[0] && ops[0].text) ? ops[0].text : "";
	
	// Only process the first operation since we're replacing everything
	// Additional cursors don't make sense for a full document replacement
	var op = ops[0];
	if(!op || typeof op !== "object") return;
	
	normalizeOp(op, text);
	
	op.cutStart = 0;
	op.cutEnd = op.text.length;
	op.replacement = params.text;
	
	// Determine new selection based on 'select' parameter
	switch(params.select) {
		case "start":
			op.newSelStart = 0;
			op.newSelEnd = 0;
			break;
		case "end":
			op.newSelStart = params.text.length;
			op.newSelEnd = params.text.length;
			break;
		case "none":
			op.newSelStart = 0;
			op.newSelEnd = 0;
			break;
		case "all":
		default:
			op.newSelStart = 0;
			op.newSelEnd = params.text.length;
			break;
	}
	
	// Mark other operations as no-op (no replacement)
	for(var i = 1; i < ops.length; i++) {
		if(ops[i]) {
			ops[i].replacement = null;
		}
	}
};