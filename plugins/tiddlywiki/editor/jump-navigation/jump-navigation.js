/*\
title: $:/plugins/tiddlywiki/editor/jump-navigation/jump-navigation.js
type: application/javascript
module-type: editor-plugin

Jump to matching brackets, edit history navigation, and link opening.

Plugin Metadata:
- name: jump-navigation
- configTiddler: $:/config/Editor/EnableJumpNavigation
- defaultEnabled: true

\*/
"use strict";

// ==================== PLUGIN METADATA ====================
exports.name = "jump-navigation";
exports.configTiddler = "$:/config/Editor/EnableJumpNavigation";
exports.defaultEnabled = true;
exports.description = "Jump to matching brackets, edit history navigation, and link opening";
exports.category = "navigation";

// ==================== PLUGIN IMPLEMENTATION ====================
exports.create = function(engine){ return new JumpNavigationPlugin(engine); };

function JumpNavigationPlugin(engine){
	this.engine = engine;
	this.name = "jump-navigation";
	this.enabled = false;

	this.history = [];
	this.histIndex = -1;
	this.maxHistory = 100;

	this.hooks = {
		beforeKeydown: this.onKeydown.bind(this),
		selectionChange: this.onSelectionChange.bind(this),
		focus: this.onFocus.bind(this)
	};
}

JumpNavigationPlugin.prototype.enable = function(){ this.enabled = true; };
JumpNavigationPlugin.prototype.disable = function(){ this.enabled = false; };

JumpNavigationPlugin.prototype.onFocus = function(){
	this.history = [];
	this.histIndex = -1;
};

JumpNavigationPlugin.prototype.onSelectionChange = function(){
	if(!this.enabled) return;
	var ta = this.engine.domNode;
	if(!ta) return;

	var pos = ta.selectionStart;
	var last = this.history[this.history.length - 1];
	if(last && last === pos) return;

	this.history.push(pos);
	if(this.history.length > this.maxHistory) this.history.shift();
	this.histIndex = this.history.length - 1;
};

JumpNavigationPlugin.prototype.onKeydown = function(event){
	if(!this.enabled) return;
	var ta = this.engine.domNode;
	if(!ta) return;

	var ctrl = event.ctrlKey || event.metaKey;

	// Edit history jump
	if(ctrl && event.altKey && !event.shiftKey) {
		if(event.key === "ArrowLeft") { event.preventDefault(); this.jumpHistory(-1); return false; }
		if(event.key === "ArrowRight"){ event.preventDefault(); this.jumpHistory(1); return false; }
	}

	// Match jump
	if(event.altKey && !ctrl && !event.shiftKey) {
		if(event.key === "[") { event.preventDefault(); this.jumpToMatch(); return false; }
		if(event.key === "]") { event.preventDefault(); this.jumpToMatch(); return false; }
		if(event.key === "Enter") { event.preventDefault(); this.openLinkUnderCursor(); return false; }
	}
};

JumpNavigationPlugin.prototype.jumpHistory = function(dir){
	if(this.history.length === 0) return;
	this.histIndex = Math.max(0, Math.min(this.history.length - 1, this.histIndex + dir));
	var pos = this.history[this.histIndex];
	var ta = this.engine.domNode;
	ta.selectionStart = pos; ta.selectionEnd = pos;
	this.engine.syncCursorFromDOM && this.engine.syncCursorFromDOM();
};

JumpNavigationPlugin.prototype.jumpToMatch = function(){
	var ta = this.engine.domNode;
	var text = ta.value;
	var pos = ta.selectionStart;

	var pairs = { "(":")", "[":"]", "{":"}", "<":">" };
	var rev = { ")":"(", "]":"[", "}":"{", ">":"<" };

	// pick char at pos-1 or pos
	var ch = text[pos] || text[pos-1];
	var at = (text[pos] ? pos : pos-1);
	if(at < 0) return;

	if(pairs[ch]) {
		var target = this.findForward(text, at, ch, pairs[ch]);
		if(target !== -1) {
			ta.selectionStart = target; ta.selectionEnd = target;
			this.engine.syncCursorFromDOM && this.engine.syncCursorFromDOM();
		}
		return;
	}
	if(rev[ch]) {
		var targetB = this.findBackward(text, at, rev[ch], ch);
		if(targetB !== -1) {
			ta.selectionStart = targetB; ta.selectionEnd = targetB;
			this.engine.syncCursorFromDOM && this.engine.syncCursorFromDOM();
		}
	}
};

JumpNavigationPlugin.prototype.findForward = function(text, pos, open, close){
	var depth = 0;
	for(var i=pos;i<text.length;i++){
		if(text[i] === open) depth++;
		else if(text[i] === close) {
			depth--;
			if(depth === 0) return i;
		}
	}
	return -1;
};

JumpNavigationPlugin.prototype.findBackward = function(text, pos, open, close){
	var depth = 0;
	for(var i=pos;i>=0;i--){
		if(text[i] === close) depth++;
		else if(text[i] === open) {
			depth--;
			if(depth === 0) return i;
		}
	}
	return -1;
};

JumpNavigationPlugin.prototype.openLinkUnderCursor = function(){
	var engine = this.engine;
	var ta = engine.domNode;
	var text = ta.value;
	var pos = ta.selectionStart;

	// Find nearest [[ ... ]]
	var left = text.lastIndexOf("[[", pos);
	var right = text.indexOf("]]", pos);
	if(left === -1 || right === -1 || right < left) return;

	var inside = text.substring(left + 2, right);
	var parts = inside.split("|");
	var target = (parts[0] || "").trim();
	if(!target) return;

	// Dispatch TW navigation event
	engine.widget && engine.widget.dispatchEvent && engine.widget.dispatchEvent({
		type: "tm-navigate",
		navigateTo: target
	});
};