/*\
title: $:/core/modules/startup/render.js
type: application/javascript
module-type: startup

Title, stylesheet and page rendering

\*/
(function(){

/*jslint node: true, browser: true */
/*global $tw: false */
"use strict";

// Export name and synchronous status
exports.name = "render";
exports.platforms = ["browser"];
exports.after = ["story"];
exports.synchronous = true;

// Default story and history lists
var PAGE_TITLE_TITLE = "$:/core/wiki/title";
var PAGE_STYLESHEET_TITLE = "$:/core/ui/RootStylesheet";
var PAGE_TEMPLATE_TITLE = "$:/core/ui/RootTemplate";

// Time (in ms) that we defer refreshing changes to draft tiddlers
var DRAFT_TIDDLER_TIMEOUT_TITLE = "$:/config/Drafts/TypingTimeout";
var THROTTLE_REFRESH_TIMEOUT = 400;

exports.startup = function() {
	// Set up the title
	$tw.titleWidgetNode = $tw.wiki.makeTranscludeWidget(PAGE_TITLE_TITLE,{document: $tw.fakeDocument, parseAsInline: true});
	$tw.titleContainer = $tw.fakeDocument.createElement("div");
	$tw.titleWidgetNode.render($tw.titleContainer,null);
	document.title = $tw.titleContainer.textContent;
	$tw.wiki.addEventListener("change",function(changes) {
		if($tw.titleWidgetNode.refresh(changes,$tw.titleContainer,null)) {
			document.title = $tw.titleContainer.textContent;
		}
	});

	function findWidgetNode(widget,type,tag) {
		if(widget.parseTreeNode.type === type && widget.parseTreeNode.tag === tag) {
			return widget;
		}
		for(var i=0; i<widget.children.length; i++) {
			return findWidgetNode(widget.children[i],type,tag);
		}
	}

	function createStyleTags() {
		for(var i=0; i<$tw.styleWidgetListNode.children.length; i++) {
			$tw.styleTiddlers.push($tw.styleWidgetListNode.children[i].parseTreeNode.itemTitle);
			var styleContainerNode = findWidgetNode($tw.styleWidgetListNode.children[i],"element","style");
			$tw.styleContainerNodes.push(styleContainerNode.domNodes[0]);
			$tw.styleWidgetListNode.children[i].assignedStyles = $tw.styleContainerNodes[i].textContent;
			$tw.styleElements.push(document.createElement("style"));
			$tw.styleElements[i].innerHTML = $tw.styleWidgetListNode.children[i].assignedStyles;
		}
		var styleTags = document.head.getElementsByTagName("style");
		if(styleTags.length) {
			for(var i=0; i<$tw.styleWidgetListNode.children.length; i++) {
				var lastStyleTag = styleTags[styleTags.length - 1],
					insertBeforeElement = lastStyleTag.nextSibling;
				document.head.insertBefore($tw.styleElements[i],insertBeforeElement);				
			}
		} else {
			for(i=($tw.styleWidgetListNode.children.length - 1); i>=0; i--) {
				document.head.insertBefore($tw.styleElements[i],document.head.firstChild);
			}
		}
	}

	function createStyleWidgetNode() {
		$tw.styleWidgetNode = $tw.wiki.makeTranscludeWidget(PAGE_STYLESHEET_TITLE,{document: $tw.fakeDocument});
		$tw.styleContainer = $tw.fakeDocument.createElement("div");
		$tw.styleWidgetNode.render($tw.styleContainer,null);
		$tw.styleWidgetListNode = findWidgetNode($tw.styleWidgetNode,"list","$list");
	}

	// Set up the styles
	createStyleWidgetNode();
	$tw.styleContainerNodes = [];
	$tw.styleElements = [];
	$tw.styleTiddlers = [];
	createStyleTags();

	$tw.wiki.addEventListener("change",function(changes) {
		if(changes[PAGE_STYLESHEET_TITLE]) {
			createStyleWidgetNode();
			if($tw.styleWidgetListNode) {
				for(var i=0; i<$tw.styleTiddlers.length; i++) {
					document.head.removeChild($tw.styleElements[i]);
				}
				$tw.styleContainerNodes = [];
				$tw.styleElements = [];
				$tw.styleTiddlers = [];
				createStyleTags();
			}
		}
		if($tw.styleWidgetListNode) {
			$tw.perf.report("styleRefresh",function() {
				if($tw.styleWidgetNode.refresh(changes,$tw.styleContainer,null)) {
					var styleTiddlers = [];
					for(var i=0; i<$tw.styleWidgetListNode.children.length; i++) {
						var stylesheetTitle = $tw.styleWidgetListNode.children[i].parseTreeNode.itemTitle;
						styleTiddlers.push(stylesheetTitle);
					}
					if(!$tw.utils.arraysEqual($tw.styleTiddlers,styleTiddlers)) {
						for(var i=0; i<$tw.styleTiddlers.length; i++) {
							document.head.removeChild($tw.styleElements[i]);
						}
						$tw.styleTiddlers = [];
						$tw.styleElements = [];
						$tw.styleContainerNodes = [];
						createStyleTags();
					} else {
						for(var i=0; i<$tw.styleWidgetListNode.children.length; i++) {
							var newStyles = $tw.styleContainerNodes[i].textContent;
							if(newStyles !== $tw.styleWidgetListNode.children[i].assignedStyles) {
								$tw.styleWidgetListNode.children[i].assignedStyles = newStyles;
								$tw.styleElements[i].innerHTML = $tw.styleWidgetListNode.children[i].assignedStyles;
							}
						}
					}
				}
			})();
		}
	});

	// Display the $:/core/ui/PageTemplate tiddler to kick off the display
	$tw.perf.report("mainRender",function() {
		$tw.pageWidgetNode = $tw.wiki.makeTranscludeWidget(PAGE_TEMPLATE_TITLE,{document: document, parentWidget: $tw.rootWidget, recursionMarker: "no"});
		$tw.pageContainer = document.createElement("div");
		$tw.utils.addClass($tw.pageContainer,"tc-page-container-wrapper");
		document.body.insertBefore($tw.pageContainer,document.body.firstChild);
		$tw.pageWidgetNode.render($tw.pageContainer,null);
   		$tw.hooks.invokeHook("th-page-refreshed");
	})();
	// Remove any splash screen elements
	var removeList = document.querySelectorAll(".tc-remove-when-wiki-loaded");
	$tw.utils.each(removeList,function(removeItem) {
		if(removeItem.parentNode) {
			removeItem.parentNode.removeChild(removeItem);
		}
	});
	// Prepare refresh mechanism
	var deferredChanges = Object.create(null),
		timerId;
	function refresh() {
		// Process the refresh
		$tw.hooks.invokeHook("th-page-refreshing");
		$tw.pageWidgetNode.refresh(deferredChanges);
		deferredChanges = Object.create(null);
		$tw.hooks.invokeHook("th-page-refreshed");
	}
	// Add the change event handler
	$tw.wiki.addEventListener("change",$tw.perf.report("mainRefresh",function(changes) {
		// Check if only tiddlers that are throttled have changed
		var onlyThrottledTiddlersHaveChanged = true;
		for(var title in changes) {
			var tiddler = $tw.wiki.getTiddler(title);
			if(!$tw.wiki.isVolatileTiddler(title) && (!tiddler || !(tiddler.hasField("draft.of") || tiddler.hasField("throttle.refresh")))) {
				onlyThrottledTiddlersHaveChanged = false;
			}
		}
		// Defer the change if only drafts have changed
		if(timerId) {
			clearTimeout(timerId);
		}
		timerId = null;
		if(onlyThrottledTiddlersHaveChanged) {
			var timeout = parseInt($tw.wiki.getTiddlerText(DRAFT_TIDDLER_TIMEOUT_TITLE,""),10);
			if(isNaN(timeout)) {
				timeout = THROTTLE_REFRESH_TIMEOUT;
			}
			timerId = setTimeout(refresh,timeout);
			$tw.utils.extend(deferredChanges,changes);
		} else {
			$tw.utils.extend(deferredChanges,changes);
			refresh();
		}
	}));
	// Fix up the link between the root widget and the page container
	$tw.rootWidget.domNodes = [$tw.pageContainer];
	$tw.rootWidget.children = [$tw.pageWidgetNode];
	// Run any post-render startup actions
	$tw.rootWidget.invokeActionsByTag("$:/tags/StartupAction/PostRender");
};

})();
