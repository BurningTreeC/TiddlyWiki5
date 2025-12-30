/*\
title: $:/core/modules/editor/operations/text/make-link.js
type: application/javascript
module-type: texteditoroperation

Text editor operation to convert selection to a TiddlyWiki link
Supports multiple cursors/selections

\*/

"use strict";

function processOperation(op, sharedText) {
	op.text = (typeof op.text === "string") ? op.text : (sharedText || "");
	op.selStart = op.selStart || 0;
	op.selEnd = op.selEnd || op.selStart;
	op.selection = op.selection || op.text.substring(op.selStart, op.selEnd);
	
	var selection = op.selection;
	
	// Check if already a link
	var beforeChars = op.text.substring(Math.max(0, op.selStart - 2), op.selStart);
	var afterChars = op.text.substring(op.selEnd, op.selEnd + 2);
	
	if(beforeChars === "[[" && afterChars === "]]") {
		// Remove link brackets
		op.cutStart = op.selStart - 2;
		op.cutEnd = op.selEnd + 2;
		op.replacement = selection;
		op.newSelStart = op.cutStart;
		op.newSelEnd = op.cutStart + selection.length;
	} else if(selection.startsWith("[[") && selection.endsWith("]]")) {
		// Selection includes brackets - remove them
		op.cutStart = op.selStart;
		op.cutEnd = op.selEnd;
		op.replacement = selection.substring(2, selection.length - 2);
		op.newSelStart = op.selStart;
		op.newSelEnd = op.selStart + op.replacement.length;
	} else {
		// Add link brackets
		op.cutStart = op.selStart;
		op.cutEnd = op.selEnd;
		op.replacement = "[[" + selection + "]]";
		op.newSelStart = op.selStart;
		op.newSelEnd = op.selStart + op.replacement.length;
	}
}

exports["make-link"] = function(event, operation) {
	var ops = Array.isArray(operation) ? operation : [operation];
	var text = (ops[0] && ops[0].text) ? ops[0].text : "";
	
	for(var i = 0; i < ops.length; i++) {
		if(ops[i] && typeof ops[i] === "object") {
			processOperation(ops[i], text);
		}
	}
};