/*\
title: $:/core/modules/editor/operations/text/save-selection.js
type: application/javascript
module-type: texteditoroperation

Text editor operation to save the current selection in a specified tiddler.
Supports multiple cursors/selections.

\*/

"use strict";

function getParams(event) {
	var p = (event && event.paramObject) ? event.paramObject : {};
	return {
		tiddler: p.tiddler || null,
		field: p.field || "text",
		separator: p.separator !== undefined ? String(p.separator) : "\n"
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

exports["save-selection"] = function(event, operation) {
	var params = getParams(event);
	
	if(!params.tiddler) return;
	
	// Handle both array and single operation
	var ops = Array.isArray(operation) ? operation : [operation];
	
	// Get the text from the first operation (they all share the same text)
	var text = (ops[0] && ops[0].text) ? ops[0].text : "";
	
	// Collect all selections
	var selections = [];
	for(var i = 0; i < ops.length; i++) {
		if(ops[i] && typeof ops[i] === "object") {
			normalizeOp(ops[i], text);
			var sel = ops[i].text.substring(ops[i].selStart, ops[i].selEnd);
			if(sel) {
				selections.push(sel);
			}
		}
	}
	
	// Join selections and save to tiddler
	var content = selections.join(params.separator);
	this.wiki.setText(params.tiddler, params.field, null, content);
};