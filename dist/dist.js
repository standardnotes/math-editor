/**
 * Markdown and LaTeX Editor
 *
 * (c) Roman Parpalak, 2016-2018
 */

(function (document, window) {
	'use strict';

	var defaults = {
		html:        true,         // Enable HTML tags in source
		xhtmlOut:    false,        // Use '/' to close single tags (<br />)
		breaks:      false,        // Convert '\n' in paragraphs into <br>
		langPrefix:  'language-',  // CSS language prefix for fenced blocks
		linkify:     true,         // autoconvert URL-like texts to links
		typographer: true,         // Enable smartypants and other sweet transforms
		quotes:      '""\'\'',

		// option for tex plugin
		_habr: {protocol: ''},    // no protocol for habrahabr markup

		// options below are for demo only
		_highlight: true,
		_strict:    false
	};

	function domSetResultView(val) {
		var eNode = document.body;

		[
			'result-as-html',
			'result-as-htmltex',
			'result-as-habr',
			'result-as-src',
			'result-as-debug'
		].forEach(function (className) {
			if (eNode.classList) {
				eNode.classList.remove(className);
			}
			else {
				eNode.className = eNode.className.replace(new RegExp('(^|\\b)' + className.split(' ').join('|') + '(\\b|$)', 'gi'), ' ');
			}
		});

		if (eNode.classList) {
			eNode.classList.add('result-as-' + val);
		}
		else {
			eNode.className += ' ' + 'result-as-' + val;
		}
	}

	function ParserCollection(
		defaults,
		imageLoader,
		markdownit,
		setResultView,
		sourceGetter,
		sourceSetter,
		domSetPreviewHTML,
		domSetHighlightedContent,
		updateCallback
	) {
		var _mdPreview = markdownit(defaults)
			.use(markdownitSub)
			.use(markdownitSup)
		;

		var _mdHtmlAndImages = markdownit(defaults)
			.use(markdownitSub)
			.use(markdownitSup)
		;

		var _mdHtmlAndTex = markdownit(defaults)
			.use(markdownitSub)
			.use(markdownitSup)
		;

		var _mdHtmlHabrAndImages = markdownit(defaults)
			.use(markdownitSub)
			.use(markdownitSup)
		;

		var _mdMdAndImages = markdownit('zero')

		;

		/**
		 * Detects if the paragraph contains the only formula.
		 * Parser gives the class 'tex-block' to such formulas.
		 *
		 * @param tokens
		 * @param idx
		 * @returns {boolean}
		 */
		function hasBlockFormula(tokens, idx) {
			if (idx >= 0 && tokens[idx] && tokens[idx].children) {
				for (var i = tokens[idx].children.length; i--;) {
					if (tokens[idx].children[i].tag === 'tex-block') {
						return true;
					}
				}
			}
			return false;
		}

		/**
		 * Inject line numbers for sync scroll. Notes:
		 * - We track only headings and paragraphs on first level. That's enough.
		 * - Footnotes content causes jumps. Level limit filter it automatically.
		 *
		 * @param tokens
		 * @param idx
		 * @param options
		 * @param env
		 * @param self
		 */
		function injectLineNumbersAndCentering(tokens, idx, options, env, self) {
			var line;
			if (tokens[idx].map && tokens[idx].level === 0) {
				line = tokens[idx].map[0];
				tokens[idx].attrPush(['class', 'line']);
				tokens[idx].attrPush(['data-line', line + '']);
			}

			// Hack (maybe it is better to use block renderers?)
			if (hasBlockFormula(tokens, idx + 1)) {
				tokens[idx].attrPush(['align', 'center']);
				tokens[idx].attrPush(['style', 'text-align: center;']);
			}

			return self.renderToken(tokens, idx, options, env, self);
		}

		// Habrahabr does not ignore <p> tags and meanwhile uses whitespaces
		function habrHeading(tokens, idx, options, env, self) {
			var prefix = "";
			if (idx > 0 && tokens[idx - 1].type === 'paragraph_close' && !hasBlockFormula(tokens, idx - 2)) {
				prefix = "\n";
			}

			return prefix + self.renderToken(tokens, idx, options, env, self);
		}

		function habrParagraphOpen(tokens, idx, options, env, self) {
			var prefix = "";
			if (idx > 0 && tokens[idx - 1].type === 'paragraph_close' && !hasBlockFormula(tokens, idx - 2)) {
				prefix = "\n";
			}
			return prefix; //+ self.renderToken(tokens, idx, options, env, self);
		}

		function habrParagraphClose(tokens, idx, options, env, self) {
			var prefix = "\n";
			return prefix; //+ self.renderToken(tokens, idx, options, env, self);
		}

		function injectCentering(tokens, idx, options, env, self) {
			// Hack (maybe it is better to use block renderers?)
			if (hasBlockFormula(tokens, idx + 1)) {
				tokens[idx].attrPush(['align', 'center']);
				tokens[idx].attrPush(['style', 'text-align: center;']);
			}
			return self.renderToken(tokens, idx, options, env, self);
		}

		_mdPreview.renderer.rules.paragraph_open = _mdPreview.renderer.rules.heading_open = injectLineNumbersAndCentering;
		_mdHtmlAndImages.renderer.rules.paragraph_open = _mdHtmlAndImages.renderer.rules.heading_open = injectCentering;

		_mdHtmlHabrAndImages.renderer.rules.heading_open    = habrHeading;
		_mdHtmlHabrAndImages.renderer.rules.paragraph_open  = habrParagraphOpen;
		_mdHtmlHabrAndImages.renderer.rules.paragraph_close = habrParagraphClose;

		// A copy of Markdown-it original backticks parser.
		// We want to prevent from parsing dollars inside backticks as TeX delimeters (`$$`).
		// But we do not want HTML in result.
		_mdMdAndImages.inline.ruler.before('backticks', 'backticks2', function (state, silent) {
			var start, max, marker, matchStart, matchEnd, token,
				pos = state.pos,
				ch = state.src.charCodeAt(pos);
			if (ch !== 0x60/* ` */) { return false; }

			start = pos;
			pos++;
			max = state.posMax;

			while (pos < max && state.src.charCodeAt(pos) === 0x60/* ` */) { pos++; }

			marker = state.src.slice(start, pos);

			matchStart = matchEnd = pos;

			while ((matchStart = state.src.indexOf('`', matchEnd)) !== -1) {
				matchEnd = matchStart + 1;

				while (matchEnd < max && state.src.charCodeAt(matchEnd) === 0x60/* ` */) { matchEnd++; }

				if (matchEnd - matchStart === marker.length) {
					if (!silent) {
						token         = state.push('backticks2_inline', 'code', 0); // <-- The change
						token.markup  = marker;
						token.content = state.src.slice(pos, matchStart)
					}
					state.pos = matchEnd;
					return true;
				}
			}

			if (!silent) { state.pending += marker; }
			state.pos += marker.length;
			return true;
		});

		_mdMdAndImages.renderer.rules.backticks2_inline = function (tokens, idx /*, options, env, slf*/) {
			var token = tokens[idx];
			return token.markup + token.content + token.markup;
		};

		// Prevents HTML escaping.
		_mdMdAndImages.renderer.rules.text = function (tokens, idx /*, options, env */) {
			return tokens[idx].content;
		};

		/**
		 * Habrahabr "source" tag
		 *
		 * @param tokens
		 * @param idx
		 * @param options
		 * @param env
		 * @param self
		 * @returns {string}
		 */
		_mdHtmlHabrAndImages.renderer.rules.fence = function (tokens, idx, options, env, self) {
			var token    = tokens[idx],
				info     = token.info ? _mdHtmlHabrAndImages.utils.unescapeAll(token.info).trim() : '',
				langName = '',
				highlighted;

			if (info) {
				langName = info.split(/\s+/g)[0];
				token.attrPush(['lang', langName]);
			}

			if (options.highlight) {
				highlighted = options.highlight(token.content, langName) || _mdHtmlHabrAndImages.utils.escapeHtml(token.content);
			} else {
				highlighted = _mdHtmlHabrAndImages.utils.escapeHtml(token.content);
			}

			return '\n<source' + self.renderAttrs(token) + '>'
				+ highlighted
				+ '</source>\n';
		};

		function getHabraMarkup(source) {
			var html = _mdHtmlHabrAndImages.render(source);

			html = html.replace('<spoiler ', '\n<spoiler ');
			return html;
		}

		this.getSource = sourceGetter;

		this.setSource = function (source) {
			sourceSetter(source);
			this.updateResult();
		};

		var _oldSource = null,
			_view      = 'html'; // html / src / debug

		this.updateResult = function () {
			var source = sourceGetter();
			if (_oldSource === source) {
				return;
			}

			_oldSource = source;

			// Always render html because we need it to generate previews for SN
			imageLoader.reset();
			domSetPreviewHTML(_mdPreview.render(source));
			imageLoader.fixDom();

      if (_view === 'debug') {
				domSetHighlightedContent(
					'result-src-content',
					JSON.stringify(_mdHtmlAndImages.parse(source, {references: {}}), null, 2),
					'json'
				);
			}
			else if (_view === 'habr') {
				domSetHighlightedContent('result-src-content', getHabraMarkup(source), 'html');
			}
			else if (_view === 'md') {
				domSetHighlightedContent('result-src-content', _mdMdAndImages.renderInline(source), 'html');
			}
			else { /*_view === 'src'*/
				domSetHighlightedContent('result-src-content', _mdHtmlAndImages.render(source), 'html');
			}

			updateCallback(source);
		};

		this.getDisplayedResult = function () {
			var source = sourceGetter();

			if (_view === 'habr') {
				return _mdHtmlHabrAndImages.render(source);
			}

			if (_view === 'md') {
				return _mdMdAndImages.renderInline(source);
			}

			return _mdHtmlAndImages.render(source);
		};

		this.getDisplayedResultFilename = function () {
			return _view + '.html';
		};

		setResultView(_view);
		this.switchView = function (view) {
			_view = view;
			setResultView(view);

			_oldSource = null;
			this.updateResult();
		}
	}

	function domSetHighlightedContent(className, content, lang) {
		var eNode = document.getElementsByClassName(className)[0];
		if (window.hljs) {
			eNode.innerHTML = window.hljs.highlight(lang, content).value;
		}
		else {
			eNode.textContent = content;
		}
	}

	function domSetPreviewHTML(html) {
		var result          = document.getElementsByClassName('result-html');
		result[0].innerHTML = html;
	}

	/**
	 * Searches start position for text blocks
	 */
	function domFindScrollMarks() {
		var resElements      = document.querySelectorAll('.result-html .line'),
			resElementHeight = [],
			line,
			mapSrc           = [0],
			mapResult        = [0],
			i                = 0,
			len              = resElements.length;

		for (; i < len; i++) {
			line = parseInt(resElements[i].getAttribute('data-line'));
			if (line) {
				resElementHeight[line] = Math.round(resElements[i].offsetTop);
			}
		}

		var srcElements = document.querySelectorAll('.ldt-pre .block-start');

		len  = srcElements.length;
		line = 0;

		for (i = 0; i < len; i++) {
			var lineDelta = parseInt(srcElements[i].getAttribute('data-line'));
			if (lineDelta) {
				line += lineDelta;

				// We track only lines in both containers
				if (typeof resElementHeight[line] !== 'undefined') {
					mapSrc.push(srcElements[i].offsetTop);
					mapResult.push(resElementHeight[line]);
				}
			}
		}

		var srcScrollHeight = document.querySelector('.ldt-pre').scrollHeight,
			lastSrcElemPos  = mapSrc[mapSrc.length - 1],
			allowedHeight   = 5; // workaround for automatic textarea scrolling on entering new source lines

		mapSrc.push(srcScrollHeight - allowedHeight > lastSrcElemPos ? srcScrollHeight - allowedHeight : lastSrcElemPos);
		mapResult.push(document.querySelector('.result-html').scrollHeight);

		return [mapSrc, mapResult];
	}

	documentReady(function () {
		var eTextarea   = document.getElementById('editor-source'),
			eResultHtml = document.getElementsByClassName('result-html')[0];

		var recalcHeight = debounce(function () {
			decorator.recalcHeight()
		}, 100);

		var scrollMap = new ScrollMap(domFindScrollMarks);

		var parserCollection = new ParserCollection(
			defaults,
			new ImageLoader(new ImagePreloader(), location.protocol === 'https:' ? 'https:' : 'http:'),
			window.markdownit,
			domSetResultView,
			function domGetSource() {
				return eTextarea.value;
			},
			function domSetSource(text) {
				eTextarea.value = text;
				decorator.update();
			},
			domSetPreviewHTML,
			domSetHighlightedContent,
			function (source) {
				// reset lines mapping cache on content update
				scrollMap.reset();
			}
		);

		parserCollection.updateResult();

		// start the decorator
		var decorator = new TextareaDecorator(eTextarea, mdParser);

		// .source has been changed after TextareaDecorator call
		var eNodeSource = document.getElementsByClassName('source')[0];

		var syncScroll = new SyncScroll(
			scrollMap,
			new Animator(function () {
				return eNodeSource.scrollTop;
			}, function (y) {
				eNodeSource.scrollTop = y;
			}),
			new Animator(function () {
				return eResultHtml.scrollTop;
			}, function (y) {
				eResultHtml.scrollTop = y;
			}),
			eNodeSource,
			eResultHtml,
			document.querySelector('[id^="container-block"]')
		);

		// Sync scroll listeners

		// var updateText = debounce(parserCollection.updateResult, 240, {maxWait: 3000});

		// We'll update text on our own
		var updateText = parserCollection.updateResult;

		// eTextarea.addEventListener('keyup', updateText);
		// eTextarea.addEventListener('paste', updateText);
		// eTextarea.addEventListener('cut', updateText);
		// eTextarea.addEventListener('mouseup', updateText);

		eTextarea.addEventListener('touchstart', syncScroll.switchScrollToSrc);
		eTextarea.addEventListener('mouseover', syncScroll.switchScrollToSrc);

		eResultHtml.addEventListener('touchstart', syncScroll.switchScrollToResult);
		eResultHtml.addEventListener('mouseover', syncScroll.switchScrollToResult);

		syncScroll.switchScrollToSrc();

		Array.prototype.forEach.call(document.getElementsByClassName('control-item'), function (eNode, index) {
			eNode.addEventListener('click', function () {
				var view = this.getAttribute('data-result-as');
				if (!view) {
					return;
				}

				parserCollection.switchView(view);

				if (view !== 'preview') {
					// Selecting all block content.
					var contentBlocks = document.getElementsByClassName('result-src-content');
					if (contentBlocks.length) {
						setTimeout(function () {
							selectText(contentBlocks[0]);
						}, 0);
					}
				}
			})
		});

		// Interface element listeners

		document.querySelector('._download-source').addEventListener('click', function () {
			var blob = new Blob([parserCollection.getSource()], {type: 'text/markdown;charset=utf-8'});
			saveAs(blob, 'source.md');
		});

		document.querySelector('._download-result').addEventListener('click', function () {
			var blob = new Blob([parserCollection.getDisplayedResult()], {type: 'text/html;charset=utf-8'});
			saveAs(blob, parserCollection.getDisplayedResultFilename());
		});

		document.querySelector('._upload-source').addEventListener('click', function () {
			var eNode = document.getElementById('fileElem');
			// Fire click on file input
			(eNode.onclick || eNode.click || function () {}).call(eNode);
		});

		document.getElementById('fileElem').addEventListener('change', function () {
			// A file has been chosen
			if (!this.files || !FileReader) {
				return;
			}

			var reader    = new FileReader(),
				fileInput = this;

			reader.onload = function () {
				parserCollection.setSource(this.result);
				fileInput.value = fileInput.defaultValue;
			};
			reader.readAsText(this.files[0]);
		});

		(function () {
			var eSlider     = document.querySelector('.slider'),
				dragSlider  = new Draggabilly(eSlider, {
					axis: 'x'
				}),
				sourceBlock = document.getElementById('source-block'),
				resultBLock = document.getElementById('result-block'),
				windowWidth;

			function setWidth(percent) {
				sourceBlock.style.width = 'calc(' + percent + '% - 3px)';
				resultBLock.style.width = 'calc(' + (100 - percent) + '% - 3px)';

				scrollMap.reset();
			}

			eSlider.addEventListener('dblclick', function () {
				setWidth(50);
			});

			dragSlider.on('dragStart', function (event, pointer, moveVector) {
				windowWidth = window.innerWidth;
			});

			dragSlider.on('dragMove', function (event, pointer, moveVector) {
				setWidth(100.0 * pointer.pageX / windowWidth);
			});
		})();

		window.upmath = {
			updateText: () => {
				updateText();
				decorator.recalcHeight()
				decorator.update();
			},
			getHTML: () => {
				var result = document.getElementsByClassName('result-html');
				return eResultHtml.innerHTML;
			}
		}

		// Need to recalculate line positions on window resize
		window.addEventListener('resize', function () {
			scrollMap.reset();
			recalcHeight();
		});
	});
})(document, window);
;/**
 * Markdown parser with latex extension
 *
 * (c) Roman Parpalak, 2015
 * Based on code by Colin Kuebler, 2012
 */

function MarkdownParser(i) {
	/* INIT */
	var api = this;

	// variables used internally
	i = i ? 'i' : '';
	var parseInlineRE = null,
		parseBlockRE = null,
		ruleMap = {},
		ruleBlockMap = {},
		ruleInlineMap = {},
		runInBlocks = {},
		markers = {};

	var subRules,
		subRulesMap = {},
		subRulesRE = {};

	function addBlockRule(s, rule) {
		var re = new RegExp('^(' + s + ')$', i);
		ruleMap[rule] = re;
		ruleBlockMap[rule] = re;
	}

	function addInlineRule(s, rule) {
		var re = new RegExp('^(' + s + ')$', i);
		ruleMap[rule] = re;
		ruleInlineMap[rule] = re;
	}

	function addSubruleMap(s, rule, block) {
		if (!subRulesMap[block]) {
			subRulesMap[block] = {};
		}
		subRulesMap[block][rule] = new RegExp('^(' + s + ')$', i);
	}

	api.addInlineRules = function (rules) {
		var ruleSrc = [];

		for (var rule in rules) {
			if (rules.hasOwnProperty(rule)) {
				var s = rules[rule].source;
				ruleSrc.push(s);
				addInlineRule(s, rule);
			}
		}

		parseInlineRE = new RegExp('(' + ruleSrc.join('|') + ')', i);

		return this;
	};
	api.addSubRules = function (rules) {
		subRules = rules;

		for (var block in rules) {
			if (rules.hasOwnProperty(block)) {
				var rules2 = rules[block],
					p = [];
				for (var rule in rules2) {
					if (rules2.hasOwnProperty(rule)) {
						var s = rules2[rule].source;
						addSubruleMap(s, rule, block);
						p.push(s);
					}
				}

				subRulesRE[block] = new RegExp('(' + p.join('|') + ')', i);
			}
		}

		return this;
	};
	api.addBlockRules = function (rules) {
		var ruleArray = [];

		for (var rule in rules) {
			if (rules.hasOwnProperty(rule)) {
				var s = rules[rule].source;
				ruleArray.push(s);
				addBlockRule(s, rule);
			}
		}
		parseBlockRE = new RegExp('(' + ruleArray.join('|') + ')', i);

		return this;
	};
	api.addRunIn = function (rules) {
		runInBlocks = rules;

		return this;
	};
	api.addMarkers = function (m) {
		markers = m;

		return this;
	};

	function tokenizeBlock(block, className, lineNum, result) {
		var re = parseInlineRE;

		// Process specific rules for the given block type className
		if (className in subRules) {
			if (subRules[className] === null) {
				result.push({
					token: block,
					block: className,
					line:  lineNum
				});

				return;
			}
			else {
				re = subRulesRE[className];
			}
		}

		// Token for a block marker
		if (typeof markers[className] !== 'undefined') {
			var matches = block.match(markers[className]);
			if (matches[2]) {
				result.push({
					token: matches[1],
					block: className + '-mark',
					line:  lineNum
				});
				block = matches[2];
				lineNum = 0; // Write block position only once
			}
		}

		var items = block.split(re),
			j = 0, token;

		for (; j < items.length; j++) {
			token = items[j];
			if (token != '') {
				result.push({
					token: token,
					block: className,
					line:  lineNum
				});
				lineNum = 0; // Write block position only once
			}
		}
	}

	api.tokenize = function (input) {
		input = input.replace('\r', '');

		var result = [],
			classNames = [],
			blocks = input.split(parseBlockRE),
			blockNum = blocks.length,
			i, prevIndex = 0, prevBlockClass;

		// Merge blocks separated by line breaks
		for (i = 0; i < blockNum; i++) {
			if (blocks[i] === '') {
				continue;
			}

			var className = identify(blocks[i], ruleBlockMap);

			if (prevIndex > 0 && className in runInBlocks) {
				var allowedPrevBlocks = runInBlocks[className].allowedBlocks;
				if (allowedPrevBlocks && allowedPrevBlocks.indexOf(prevBlockClass) >= 0) {
					blocks[prevIndex] += blocks[i];
					blocks[i] = '';
					classNames[i] = '';

					continue;
				}
			}

			classNames[i] = className;

			prevIndex = i;
			prevBlockClass = className;
		}

		var lineBreakCnt = 0;

		for (i = 0; i < blockNum; i++) {
			var block = blocks[i];
			if (block !== '') {
				var lineNum = 0;
				if (classNames[i] != 'empty') { // TODO move to config
					lineNum = lineBreakCnt;
					lineBreakCnt = 0; // Storing diff between line numbers
				}
				tokenizeBlock(block, classNames[i], lineNum, result);
				lineBreakCnt += substrCount('\n', block);
			}
		}

		return result;
	};
	api.identifyInline = function (tokenObj) {
		var className = tokenObj.block,
			map = ruleInlineMap;

		if (className in subRules) {
			if (subRules[className] === null) {
				return '';
			}
			else {
				map = subRulesMap[className];
			}
		}
		return identify(tokenObj.token, map);
	};

	function identify(token, ruleMap) {
		for (var rule in ruleMap) {
			if (ruleMap.hasOwnProperty(rule) && ruleMap[rule].test(token)) {
				return rule;
			}
		}

		return '';
	}

	return api;
}

// Markdown syntax parser
var mdParser = new MarkdownParser();

mdParser
	.addBlockRules({
		latexBlock: /[ \t]*\$\$\n?(?:[^\n]+\n)*(?:[^\n]*[^\\\n])?\$\$(?:[ \t]*\([ \t]*\S+[ \t]*\))?[ \t]*(?:\n|$)/,
		empty:      /(?:[ \t]*\n)+/,
		fence:      /```[\s\S]*?(?:$|```(?:\n|$))/,
		reference:  /\[[^\]]+\]\:[^\n]*(?:\n|$)/,
		header:     /#{1,6} [^\n]*(?:\n|$)/,
		header2:    /[^\n]+\n[ \t]*[=-]{2,}(?:\n|$)/,
		rule:       /(?:[\*]{3,}|[\-]{3,}|[\_]{3,})(?:\n|$)/,
		list:       /[ ]{0,3}(?:[+\-\*]|\d+\.)[ \t]+[^\n]*(?:\n[ \t]*[^\n\t ]+[ \t]*)*(?:\n|$)/,
		quote:      /[ ]{0,3}>[^\n]*(?:\n|$)/,
		paragraph:  /[\s\S]*?(?:\n|$)/
	})
	.addInlineRules({
		latex:      /\$\$(?:[\s\S]*?[^\\])?\$\$/,
		link:       /\[.+?\][\(\[].*?[\)\]]/,
		bold:       /(?:\s|^)__[\s\S]*?\S__|\*\*[\s\S]*?\S\*\*/,
		italic:     /(?:\s|^)_[\s\S]*?[^\\\s]_|\*[^\\\s]\*|\*\S[\s\S]*?[^\\\s]\*/,
		strike:     /~~.+?~~/,
		sup:        /\^.+?\^/,
		sub:        /~.+?~/,
		code:       /``.+?``|`.*?[^`\\]`(?!`)/
	})
	.addSubRules({
		fence: null,
		rule:  null,
		latexBlock: {
			comment:   /%[^\n]*?(?=\$\$)|%[^\n]*/,
			reference: /[ \t]*\([ \t]*\S+[ \t]*\)[ \t\n]*$/,
			index:     /(?:\^|_)(?:\\[a-zA-Zа-яА-я]+[\*]?(?:\{.*?\})|\{[a-zA-Zа-яА-я0-9]*?\}|[a-zA-Zа-яА-я0-9])/,
			bracket:   /(?:(?:\\left|\\right)?[\{\}\[\]\(\)\|])/,
			keyword:   /\\[a-zA-Zа-яА-я]+[\*]?/,
			keyword2:  /\\[^a-zA-Zа-яА-я0-9]/,
			keyword3:  /&/,
			delimeter: /\$\$/
		}
	})
	.addRunIn({
		paragraph: {
			allowedBlocks : ['paragraph', 'quote', 'list']
		}
	})
	.addMarkers({
		list:  /^([ ]{0,3}(?:[+\-\*]|\d+\.)[ \t]+)([\s\S]*)$/,
		quote: /^([ ]{0,3}(?:>[ \t]*)+)([\s\S]*)$/
	});
;'use strict';

/**
 * DOMContentLoaded polyfill
 *
 * @param fn
 */
function documentReady(fn) {
	if (document.readyState != 'loading') {
		fn();
	}
	else {
		document.addEventListener('DOMContentLoaded', fn);
	}
}

/**
 * Find the index of a maximum value in values array
 * which is less than maxValue.
 *
 * @param maxValue
 * @param values
 *
 * @returns {object}
 */
function findBisect(maxValue, values) {
	var a = 0,
		b = values.length - 1,
		f_a = values[a];

	if (f_a >= maxValue) {
		return {val: a, part: 0};
	}

	var f_b = values[b];
	if (f_b < maxValue) {
		return {val: b, part: 0};
	}

	while (b - a > 1) {
		var c = a + Math.round((b - a) / 2),
			f_c = values[c];

		if (f_c >= maxValue) {
			b = c;
			f_b = f_c;
		}
		else {
			a = c;
			f_a = f_c;
		}
	}

	return {val: a, part: (maxValue - f_a) / (f_b - f_a)};
}

/**
 * Count the number of occurances of a substring in a string
 *
 * @param substr
 * @param str
 * @returns {number}
 */
function substrCount(substr, str) {
	var count = -1,
		index = -2;

	while (index != -1) {
		count++;
		index = str.indexOf(substr, index + 1)
	}

	return count;
}

/**
 * Selects the content of the given DOM node.
 *
 * @param eNode
 */
function selectText(eNode) {
	if (!window.getSelection) {
		return;
	}

	var selection = window.getSelection(),
		range = document.createRange();

	range.selectNodeContents(eNode);
	selection.removeAllRanges();
	selection.addRange(range);
}

/**
 * Realistic animation module based on one-dimensional physical model.
 *
 * @param positionGetter
 * @param positionSetter
 * @constructor
 */
function Animator(positionGetter, positionSetter) {
	var x = 0,
		x1 = 0,
		x2 = 0,
		v = 0,
		animationTime = 200,
		timerId,
		startedAt = null;

	var loop = function (timestamp) {
		if (startedAt === null) {
			startedAt = timestamp;
		}

		var moveTime = timestamp - startedAt;

		if (moveTime < moveDuration) {
			// New position and velocity
			x = x2 + A * (Math.cos(omega * (moveTime - moveDuration)) - 1);
			v = A * omega * (Math.sin(omega * (moveDuration - moveTime)));

			positionSetter(x);

			timerId = requestAnimationFrame(loop);

			if (isReInit) {
				/**
				 * If the position has been forced, we run the animation again.
				 */
				initMotion(reInitPosition, x);
				isReInit = false;
				startedAt = timestamp;
			}
		}
		else {
			// Stop the animation
			startedAt = null;

			v = 0;
			positionSetter(x2);
			cancelAnimationFrame(timerId);

			if (isReInit) {
				isReInit = false;
			}
		}
	};

	/**
	 * The moveDuration of animation. It can be less than animationTime in case of high speed.
	 */
	var moveDuration;

	/**
	 * Motion parameters. See the loop formulas.
	 */
	var A, omega;

	/**
	 * Flag fired when the final position has been changed during running amination.
	 */
	var isReInit = false;

	/**
	 * New value for final position (that has been changed during running amination).
	 */
	var reInitPosition;

	/**
	 * Calculate parameters A and omega for the position given by formula
	 *
	 * x(t) = x0 + A * (Math.cos(omega * (t - t0)) - 1);
	 *
	 * @param newPosition
	 * @param oldPosition
	 */
	function initMotion(newPosition, oldPosition) {
		var k;
		x2 = newPosition;
		x1 = oldPosition;

		if (Math.abs(v) < 0.00001) {
			// Rest
			k = Math.PI;
			moveDuration = animationTime;
		}
		else {
			// Motion

			var alpha = (x2 - x1) / v / animationTime; // Motion parameter

			/**
			 * Instead of solving non-linear equation alpha * k = tan(k/2)
			 * we use approximation 0.5/a = 1 - (k/pi)^2
			 */
			if (alpha < 0 || alpha > 0.5) {
				k = Math.PI * Math.sqrt(1 - 0.5 / alpha);
			}
			else {
				k = 0.1;
			}

			/**
			 * After approximate value of k is determined, we redefine alpha
			 * since its value affects the animation. It means that the total
			 * animation duration (moveDuration) differs from animationTime.
			 * However, the difference does not impact the user experience.
			 */
			var alpha1 = (1 - Math.cos(k)) / k / Math.sin(k);
			moveDuration = (x2 - x1) / alpha1 / v;
		}

		omega = k / moveDuration;
		A = (x2 - x1) / (1 - Math.cos(k));
	}

	/**
	 * Public control method
	 *
	 * @param nextPos
	 */
	this.setPos = function (nextPos) {
		isReInit = (startedAt !== null);
		if (!isReInit) {
			x = positionGetter();
			initMotion(nextPos, x);
			timerId = requestAnimationFrame(loop);
		}
		else {
			reInitPosition = nextPos;
		}
	};

	this.stop = function () {
		startedAt = null;
		v = 0;
		cancelAnimationFrame(timerId);
		isReInit = false;
	};
}

function escapeRegExp(str) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}

/**
 * See http://stackoverflow.com/questions/1144783/replacing-all-occurrences-of-a-string-in-javascript
 * @param search
 * @param replacement
 * @returns {string}
 */
String.prototype.replaceAll = function (search, replacement) {
	var target = this;
	return target.replace(new RegExp(escapeRegExp(search), 'g'), replacement);
};

/**
 *
 * @constructor
 */
function ImagePreloader() {
	var data = {},
		uniqueIndex = 0;

	function ajaxReady() {
		var svg;

		if (this.status >= 200 && this.status < 400) {
			svg = this.responseText;
		}
		else {
			// We reached our target server, but it returned an error
			svg = '<svg height="24" version="1.1" width="24" xmlns="http://www.w3.org/2000/svg">' +
				'<g transform="translate(0 -1028.4)">' +
				'<path d="m22 12c0 5.523-4.477 10-10 10-5.5228 0-10-4.477-10-10 0-5.5228 4.4772-10 10-10 5.523 0 10 4.4772 10 10z" fill="#742600" transform="translate(0 1029.4)"/>' +
				'<path d="m22 12c0 5.523-4.477 10-10 10-5.5228 0-10-4.477-10-10 0-5.5228 4.4772-10 10-10 5.523 0 10 4.4772 10 10z" fill="#AB562B" transform="translate(0 1028.4)"/>' +
				'<path d="m7.0503 1037.8 3.5357 3.6-3.5357 3.5 1.4142 1.4 3.5355-3.5 3.536 3.5 1.414-1.4-3.536-3.5 3.536-3.6-1.414-1.4-3.536 3.5-3.5355-3.5-1.4142 1.4z" fill="#742600"/>' +
				'<path d="m7.0503 1036.8 3.5357 3.6-3.5357 3.5 1.4142 1.4 3.5355-3.5 3.536 3.5 1.414-1.4-3.536-3.5 3.536-3.6-1.414-1.4-3.536 3.5-3.5355-3.5-1.4142 1.4z" fill="#ecf0f1"/>' +
				'</g>' +
				'</svg>';
		}
		setImage(this.responseURL || this.s2Url, svg)
	}

	function loadImage(url) {
		var request = new XMLHttpRequest();
		request.open('GET', url, true);
		request.s2Url = url;
		request.onload = ajaxReady;
		request.onerror = function () {
			// There was a connection error of some sort
		};
		request.send();

		return request;
	}

	this.onLoad = function (url, callback) {
		if (!data[url]) {
			data[url] = {
				svg: null,
				baseline: null,
				request: loadImage(url),
				callback: callback
			};
		}
		else if (data[url].svg !== null) {
			callback(url, data[url].svg, data[url].baseline)
		}
		// In case of duplicate pictures we skip duplicates (when data[url].svg === null)
	};

	/**
	 * Make ids in svg unique across the html code by adding a prefix.
	 *
	 * @param svg
	 * @returns {*}
	 */
	function makeSvgIdsUnique(svg) {
		var m = svg.match(/id=["']([^"']*)["']/g);

		if (!m) {
			return svg;
		}

		var i = m.length,
			id, newId, curStr;

		for (; i--;) {
			curStr = m[i];
			id = curStr.match(/id=["']([^"']*)["']/)[1];
			newId = 's' + uniqueIndex + id;

			svg = svg
				.replaceAll(curStr, 'id="' + newId + '"')
				.replaceAll('#' + id, '#' + newId)
			;
		}

		uniqueIndex++;

		return svg;
	}

	/**
	 * Stores sizes, source and removes the xhr object.
	 * @param url
	 * @param svg
	 */
	var setImage = function (url, svg) {
		var urlData = data[url];
		if (!urlData) {
			return;
		}

		svg = makeSvgIdsUnique(svg);

		var m = svg.match(/postMessage\((?:&quot;|")([\d\|\.\-eE]*)(?:&quot;|")/); // ["&quot;2.15299|31.42377|11.65223|&quot;", "2.15299|31.42377|11.65223|"]
		if (m) {
			var baselineShift = m && m[1] ? m[1].split('|').shift() : 0; // 2.15299
		}
		else {
			// svg can be empty like "<svg xmlns="http://www.w3.org/2000/svg"/>"
			// Mark as something is wrong.
			baselineShift = null;
		}

		urlData.callback(url, svg, baselineShift);

		urlData.svg = svg;
		urlData.baseline = baselineShift;
		urlData.request = null;
		urlData.callback = null;
	};

	/**
	 * External API
	 *
	 * @param url
	 * @returns {null}
	 */
	this.getImageDataFromUrl = function (url) {
		var urlData = data[url];
		return urlData ? urlData : null;
	};
}

/**
 *
 * @param preloader
 * @param protocol  Needed for support the "file:" protocol.
 * @constructor
 */
function ImageLoader(preloader, protocol) {
	var curItems = [],  // current formula content
		prevItems = [], // previous formula content
		map = {},       // maps formula content to index
		n = 0,          // current formula number

		placeholderTimer = null,
		placeholderIndex = null,
		placeholderUrl = null;

	/**
	 * Find if user has edited only one formula formula.
	 */
	function detectPlaceholderFormula() {
		if (n == prevItems.length) {
			var editNum = 0, index, i = n;

			for (; i--;) {
				if (curItems[i] != prevItems[i]) {
					editNum++;
					index = i;
				}
			}

			if (editNum == 1) {
				if (placeholderIndex === null) {
					// A formula has been changed.
					// Use previous one as a placeholder.
					placeholderIndex = index;
					placeholderUrl = prevItems[index];
					return;
				}
				if (placeholderIndex === index) {
					// Formula has been changed again since previous change,
					// but the previous image has not been loaded yet.
					// Keep previous placeholder.
					return;
				}
			}
		}

		// Many formulas has been changed. We do not display any placeholders.
		placeholderIndex = null;
		placeholderUrl = null;
	}

	function buildMap() {
		map = {};
		for (var i = n; i--;) {
			var url = curItems[i];

			if (typeof map[url] === 'undefined') {
				map[url] = [i]
			}
			else {
				map[url].push(i);
			}
		}
	}

	/**
	 * Start parsing process.
	 */
	this.reset = function () {
		curItems = [];
		n = 0;
	};

	/**
	 * Insert SVG images.
	 *
	 * @param url
	 * @param svg
	 * @param baselineShift
	 */
	var callback = function (url, svg, baselineShift) {
		var indexes = map[url], i;

		if (indexes && (i = indexes.length)) {
			for (; i--;) {
				var index = indexes[i];

				insertPicture(index, svg, baselineShift, index === placeholderIndex ? 'fade-in' : 'replace');

				if (index === placeholderIndex) {
					// Clear the fade out timer if the new image has just bee
					clearTimeout(placeholderTimer);
					placeholderIndex = null;
					placeholderUrl = null;
				}
			}
		}
	};

	/**
	 * Mark formula as loading.
	 * Use previous image but transparent.
	 *
	 * @param index
	 * @param svg
	 * @param baselineShift
	 * @param mode One of 'replace', 'fade-in', 'fade-out'
	 */
	function insertPicture(index, svg, baselineShift, mode) {
		var id = 's2tex_' + index,
			oldSvgNode = document.getElementById(id),
			parentNode = oldSvgNode.parentNode,
			startOpacity = '1', // mode == 'fade-in' ? '0.5' : '1', // sometimes images opacity can be '1' yet. How can one track it?
			finalOpacity = mode == 'fade-out' ? '0.5' : '1',
			newSvgAttrs = '<svg class="svg-preview" id="' + id + '" ';

		if (baselineShift === null) {
			// svg has been loaded but something went wrong.
			newSvgAttrs += 'width="13px" height="13px" ';
		}
		else {
			newSvgAttrs += 'style="vertical-align:' + (-baselineShift) + 'pt; opacity: ' + startOpacity + '" ';
		}

		// Polyfill for outerHTML
		var divNode = document.createElement('div');
		divNode.innerHTML = svg.replace('<svg ', newSvgAttrs);

		var newSvgNode = divNode.firstElementChild; // there can be comments before <svg>
		divNode.removeChild(newSvgNode);

		parentNode.insertBefore(newSvgNode, oldSvgNode);
		parentNode.removeChild(oldSvgNode);

		if (finalOpacity != startOpacity) {
			placeholderTimer = setTimeout(function () {
				document.getElementById(id).style.opacity = finalOpacity;
			}, 0);
		}
	}

	/**
	 * Finish the parsing process.
	 */
	this.fixDom = function () {
		detectPlaceholderFormula();
		buildMap();
		for (var i = n; i--;) {
			preloader.onLoad(curItems[i], callback);
		}

		if (placeholderIndex !== null) {
			var data = preloader.getImageDataFromUrl(placeholderUrl);
			if (data !== null && data.callback === null) {
				insertPicture(placeholderIndex, data.svg, data.baseline, 'fade-out');
			}
		}

		prevItems = curItems.slice(0);
	};
}

/**
 * Access to the map between blocks in sync scroll.
 *
 * @param mapBuilder
 * @constructor
 */
function ScrollMap(mapBuilder) {
	var map = null;

	this.reset = function () {
		map = [null, null];
	};

	this.getPosition = function (eBlockNode, fromIndex, toIndex) {
		var offsetHeight = eBlockNode.offsetHeight;
		var scrollTop    = eBlockNode.scrollTop;

		if (scrollTop == 0) {
			return 0;
		}

		if (map[fromIndex] === null) {
			map = mapBuilder();
		}

		var maxMapIndex = map[fromIndex].length - 1;
		if (map[fromIndex][maxMapIndex] <= scrollTop + offsetHeight) {
			return map[toIndex][maxMapIndex] - offsetHeight
		}

		var scrollShift    = offsetHeight / 2,
			scrollLevel    = scrollTop + scrollShift,
			blockIndex     = findBisect(scrollLevel, map[fromIndex]),
			srcScrollLevel = parseFloat(map[toIndex][blockIndex.val] * (1 - blockIndex.part));

		if (map[toIndex][blockIndex.val + 1]) {
			srcScrollLevel += parseFloat(map[toIndex][blockIndex.val + 1] * blockIndex.part);
		}

		return srcScrollLevel - scrollShift;
	}
}

/**
 * Controls sync scroll of the source and preview blocks
 *
 * @param scrollMap
 * @param animatorSrc
 * @param animatorResult
 * @param eSrc
 * @param eResult
 * @param eContainer
 * @constructor
 */
function SyncScroll(scrollMap, animatorSrc, animatorResult, eSrc, eResult, eContainer) {
	// Synchronize scroll position from source to result
	var syncResultScroll = function () {
		animatorResult.setPos(scrollMap.getPosition(eSrc, 0, 1));
	};

	// Synchronize scroll position from result to source
	var syncSrcScroll = function () {
		animatorSrc.setPos(scrollMap.getPosition(eResult, 1, 0));
	};

	this.switchScrollToSrc = function () {
		eResult.removeEventListener('scroll', syncSrcScroll);
		eSrc.removeEventListener('scroll', syncResultScroll);
		eSrc.addEventListener('scroll', syncResultScroll);
		eContainer.id = 'container-block-source';
		// animatorSrc.stop();
	};

	this.switchScrollToResult = function () {
		eSrc.removeEventListener('scroll', syncResultScroll);
		eResult.removeEventListener('scroll', syncSrcScroll);
		eResult.addEventListener('scroll', syncSrcScroll);
		eContainer.id = 'container-block-result';
		// animatorResult.stop();
	}
}

/**
 * Functions from lodash.js
 * @see https://github.com/lodash/lodash/
 */

var now = Date.now || function () {
		return new Date().getTime();
	};

function debounce(func, wait, options) {
	var args,
		maxTimeoutId,
		result,
		stamp,
		thisArg,
		timeoutId,
		trailingCall,
		lastCalled = 0,
		leading = false,
		maxWait = false,
		trailing = true;

	if (typeof func != 'function') {
		throw new TypeError(FUNC_ERROR_TEXT);
	}
	wait = wait < 0 ? 0 : (+wait || 0);
	if (typeof options === 'object') {
		leading = !!options.leading;
		maxWait = 'maxWait' in options && Math.max(+options.maxWait || 0, wait);
		trailing = 'trailing' in options ? !!options.trailing : trailing;
	}

	function cancel() {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
		if (maxTimeoutId) {
			clearTimeout(maxTimeoutId);
		}
		lastCalled = 0;
		maxTimeoutId = timeoutId = trailingCall = undefined;
	}

	function complete(isCalled, id) {
		if (id) {
			clearTimeout(id);
		}
		maxTimeoutId = timeoutId = trailingCall = undefined;
		if (isCalled) {
			lastCalled = now();
			result = func.apply(thisArg, args);
			if (!timeoutId && !maxTimeoutId) {
				args = thisArg = undefined;
			}
		}
	}

	function delayed() {
		var remaining = wait - (now() - stamp);
		if (remaining <= 0 || remaining > wait) {
			complete(trailingCall, maxTimeoutId);
		} else {
			timeoutId = setTimeout(delayed, remaining);
		}
	}

	function maxDelayed() {
		complete(trailing, timeoutId);
	}

	function debounced() {
		args = arguments;
		stamp = now();
		thisArg = this;
		trailingCall = trailing && (timeoutId || !leading);

		if (maxWait === false) {
			var leadingCall = leading && !timeoutId;
		} else {
			if (!maxTimeoutId && !leading) {
				lastCalled = stamp;
			}
			var remaining = maxWait - (stamp - lastCalled),
				isCalled = remaining <= 0 || remaining > maxWait;

			if (isCalled) {
				if (maxTimeoutId) {
					maxTimeoutId = clearTimeout(maxTimeoutId);
				}
				lastCalled = stamp;
				result = func.apply(thisArg, args);
			}
			else if (!maxTimeoutId) {
				maxTimeoutId = setTimeout(maxDelayed, remaining);
			}
		}
		if (isCalled && timeoutId) {
			timeoutId = clearTimeout(timeoutId);
		}
		else if (!timeoutId && wait !== maxWait) {
			timeoutId = setTimeout(delayed, wait);
		}
		if (leadingCall) {
			isCalled = true;
			result = func.apply(thisArg, args);
		}
		if (isCalled && !timeoutId && !maxTimeoutId) {
			args = thisArg = undefined;
		}
		return result;
	}
	debounced.cancel = cancel;
	return debounced;
}
;/**
 * TextareaDecorator.js
 * written by Colin Kuebler 2012
 * Updated by Roman Parpalak, 2015.
 * Part of LDT, dual licensed under GPLv3 and MIT
 * Builds and maintains a styled output layer under a textarea input layer
 */

function TextareaDecorator(textarea, parser) {
	/* INIT */
	var api = this,
		output;

	if (textarea.className !== 'ldt-textarea') {
		// construct editor DOM
		var parent = document.createElement("div");
		output = document.createElement("pre");
		output.className = 'ldt-pre';
		parent.appendChild(output);

		var label = document.createElement("label");
		label.className = 'ldt-label';

		parent.appendChild(label);

		// replace the textarea with RTA DOM and reattach on label
		textarea.parentNode.replaceChild(parent, textarea);
		label.appendChild(textarea);

		// transfer the CSS styles to our editor
		parent.className = 'ldt ' + textarea.className;
		textarea.className = 'ldt-textarea';
	} else {
		output = textarea.parentNode.previousSibling;
	}

	/**
	 * Composes token class.
	 *
	 * Tokens are grouped into blocks.
	 * Also a token have its own type.
	 *
	 * @param blockClass  token block type
	 * @param inlineClass token type
	 * @returns {string}
	 */
	function getClass(blockClass, inlineClass) {
		return blockClass + ' ' + inlineClass;
	}

	/**
	 * Detect changes between a token and its DOM representation.
	 *
	 * @param newToken hash object
	 * @param oldNode  DOM node converted from old hash object
	 *
	 * @returns {boolean}
	 */
	function compareTokens(newToken, oldNode) {
		if (newToken.token !== oldNode.textContent) {
			return false;
		}

		var className = oldNode.className,
			oldBlock = className.slice(0, className.indexOf(' '));

		if (oldBlock !== newToken.block) {
			return false;
		}

		var line = oldNode.getAttribute('data-line');

		if (line && line != newToken.line) {
			return false;
		}

		return true;
	}

	/**
	 * Updates a DOM node by a token
	 *
	 * @param node
	 * @param token
	 * @param inlineClass
	 */
	function fillTokenNode(node, token, inlineClass) {
		node.textContent = node.innerText = token.token;

		var c = getClass(token.block, inlineClass);

		if (token.line) {
			node.className = c + ' block-start';
			node.setAttribute('data-line', token.line);
		}
		else {
			node.className = c;
		}
	}

	// coloring algorithm
	var color = function (input, output, parser) {
		var lastChar = input !== '' && input.substring(input.length - 1) || '';
		if (lastChar == "\r" || lastChar == "\n") {
			// Hack for the case when the last line in textarea is empty
			input += ' ';
		}

		var nodes = output.childNodes,
			tokens = parser.tokenize(input),
			firstDiff, lastDiffNew, lastDiffOld;

		// find the first difference
		for (firstDiff = 0; firstDiff < tokens.length && firstDiff < nodes.length; firstDiff++) {
			if (!compareTokens(tokens[firstDiff], nodes[firstDiff])) {
				break;
			}
		}

		// trim the length of output nodes to the size of the input
		while (tokens.length < nodes.length) {
			output.removeChild(nodes[firstDiff]);
		}

		// find the last difference
		for (lastDiffNew = tokens.length - 1, lastDiffOld = nodes.length - 1; firstDiff < lastDiffOld; lastDiffNew--, lastDiffOld--) {
			if (!compareTokens(tokens[lastDiffNew], nodes[lastDiffOld])) {
				break;
			}
		}

		// update modified nodes
		for (; firstDiff <= lastDiffOld; firstDiff++) {
			var token = tokens[firstDiff];
			fillTokenNode(nodes[firstDiff], token, parser.identifyInline(token));
		}

		// add in modified nodes
		for (var insertionPt = nodes[firstDiff] || null; firstDiff <= lastDiffNew; firstDiff++) {
			var span = document.createElement("span");
			token = tokens[firstDiff];
			fillTokenNode(span, token, parser.identifyInline(token));
			output.insertBefore(span, insertionPt);
		}
	};

	api.input = textarea;
	api.output = output;
	api.recalcHeight = function () {
		api.input.style.height = Math.max(api.output.offsetHeight, 100) + 'px';
	};
	api.update = function () {
		var input = textarea.value;
		if (input) {
			color(input, output, parser);

		} else {
			// clear the display
			output.innerHTML = '';
		}
		api.recalcHeight();
	};

	// detect all changes to the textarea,
	// including keyboard input, cut/copy/paste, drag & drop, etc
	if (textarea.addEventListener) {
		// standards browsers: oninput event
		textarea.addEventListener("input", api.update, false);
	} else {
		// MSIE: detect changes to the 'value' property
		textarea.attachEvent("onpropertychange",
			function (e) {
				if (e.propertyName.toLowerCase() === 'value') {
					api.update();
				}
			}
		);
	}
	// initial highlighting
	api.update();

	return api;
}

/* FileSaver.js
 * A saveAs() FileSaver implementation.
 * 2015-05-07.2
 *
 * By Eli Grey, http://eligrey.com
 * License: X11/MIT
 *   See https://github.com/eligrey/FileSaver.js/blob/master/LICENSE.md
 */

/*global self */
/*jslint bitwise: true, indent: 4, laxbreak: true, laxcomma: true, smarttabs: true, plusplus: true */

/*! @source http://purl.eligrey.com/github/FileSaver.js/blob/master/FileSaver.js */

var saveAs = saveAs || (function(view) {
	"use strict";
	// IE <10 is explicitly unsupported
	if (typeof navigator !== "undefined" && /MSIE [1-9]\./.test(navigator.userAgent)) {
		return;
	}
	var
		  doc = view.document
		  // only get URL when necessary in case Blob.js hasn't overridden it yet
		, get_URL = function() {
			return view.URL || view.webkitURL || view;
		}
		, save_link = doc.createElementNS("http://www.w3.org/1999/xhtml", "a")
		, can_use_save_link = "download" in save_link
		, click = function(node) {
			var event = doc.createEvent("MouseEvents");
			event.initMouseEvent(
				"click", true, false, view, 0, 0, 0, 0, 0
				, false, false, false, false, 0, null
			);
			node.dispatchEvent(event);
		}
		, webkit_req_fs = view.webkitRequestFileSystem
		, req_fs = view.requestFileSystem || webkit_req_fs || view.mozRequestFileSystem
		, throw_outside = function(ex) {
			(view.setImmediate || view.setTimeout)(function() {
				throw ex;
			}, 0);
		}
		, force_saveable_type = "application/octet-stream"
		, fs_min_size = 0
		// See https://code.google.com/p/chromium/issues/detail?id=375297#c7 and
		// https://github.com/eligrey/FileSaver.js/commit/485930a#commitcomment-8768047
		// for the reasoning behind the timeout and revocation flow
		, arbitrary_revoke_timeout = 500 // in ms
		, revoke = function(file) {
			var revoker = function() {
				if (typeof file === "string") { // file is an object URL
					get_URL().revokeObjectURL(file);
				} else { // file is a File
					file.remove();
				}
			};
			if (view.chrome) {
				revoker();
			} else {
				setTimeout(revoker, arbitrary_revoke_timeout);
			}
		}
		, dispatch = function(filesaver, event_types, event) {
			event_types = [].concat(event_types);
			var i = event_types.length;
			while (i--) {
				var listener = filesaver["on" + event_types[i]];
				if (typeof listener === "function") {
					try {
						listener.call(filesaver, event || filesaver);
					} catch (ex) {
						throw_outside(ex);
					}
				}
			}
		}
		, auto_bom = function(blob) {
			// prepend BOM for UTF-8 XML and text/* types (including HTML)
			if (/^\s*(?:text\/\S*|application\/xml|\S*\/\S*\+xml)\s*;.*charset\s*=\s*utf-8/i.test(blob.type)) {
				return new Blob(["\ufeff", blob], {type: blob.type});
			}
			return blob;
		}
		, FileSaver = function(blob, name) {
			blob = auto_bom(blob);
			// First try a.download, then web filesystem, then object URLs
			var
				  filesaver = this
				, type = blob.type
				, blob_changed = false
				, object_url
				, target_view
				, dispatch_all = function() {
					dispatch(filesaver, "writestart progress write writeend".split(" "));
				}
				// on any filesys errors revert to saving with object URLs
				, fs_error = function() {
					// don't create more object URLs than needed
					if (blob_changed || !object_url) {
						object_url = get_URL().createObjectURL(blob);
					}
					if (target_view) {
						target_view.location.href = object_url;
					} else {
						var new_tab = view.open(object_url, "_blank");
						if (new_tab == undefined && typeof safari !== "undefined") {
							//Apple do not allow window.open, see http://bit.ly/1kZffRI
							view.location.href = object_url
						}
					}
					filesaver.readyState = filesaver.DONE;
					dispatch_all();
					revoke(object_url);
				}
				, abortable = function(func) {
					return function() {
						if (filesaver.readyState !== filesaver.DONE) {
							return func.apply(this, arguments);
						}
					};
				}
				, create_if_not_found = {create: true, exclusive: false}
				, slice
			;
			filesaver.readyState = filesaver.INIT;
			if (!name) {
				name = "download";
			}
			if (can_use_save_link) {
				object_url = get_URL().createObjectURL(blob);
				save_link.href = object_url;
				save_link.download = name;
				click(save_link);
				filesaver.readyState = filesaver.DONE;
				dispatch_all();
				revoke(object_url);
				return;
			}
			// Object and web filesystem URLs have a problem saving in Google Chrome when
			// viewed in a tab, so I force save with application/octet-stream
			// http://code.google.com/p/chromium/issues/detail?id=91158
			// Update: Google errantly closed 91158, I submitted it again:
			// https://code.google.com/p/chromium/issues/detail?id=389642
			if (view.chrome && type && type !== force_saveable_type) {
				slice = blob.slice || blob.webkitSlice;
				blob = slice.call(blob, 0, blob.size, force_saveable_type);
				blob_changed = true;
			}
			// Since I can't be sure that the guessed media type will trigger a download
			// in WebKit, I append .download to the filename.
			// https://bugs.webkit.org/show_bug.cgi?id=65440
			if (webkit_req_fs && name !== "download") {
				name += ".download";
			}
			if (type === force_saveable_type || webkit_req_fs) {
				target_view = view;
			}
			if (!req_fs) {
				fs_error();
				return;
			}
			fs_min_size += blob.size;
			req_fs(view.TEMPORARY, fs_min_size, abortable(function(fs) {
				fs.root.getDirectory("saved", create_if_not_found, abortable(function(dir) {
					var save = function() {
						dir.getFile(name, create_if_not_found, abortable(function(file) {
							file.createWriter(abortable(function(writer) {
								writer.onwriteend = function(event) {
									target_view.location.href = file.toURL();
									filesaver.readyState = filesaver.DONE;
									dispatch(filesaver, "writeend", event);
									revoke(file);
								};
								writer.onerror = function() {
									var error = writer.error;
									if (error.code !== error.ABORT_ERR) {
										fs_error();
									}
								};
								"writestart progress write abort".split(" ").forEach(function(event) {
									writer["on" + event] = filesaver["on" + event];
								});
								writer.write(blob);
								filesaver.abort = function() {
									writer.abort();
									filesaver.readyState = filesaver.DONE;
								};
								filesaver.readyState = filesaver.WRITING;
							}), fs_error);
						}), fs_error);
					};
					dir.getFile(name, {create: false}, abortable(function(file) {
						// delete file if it already exists
						file.remove();
						save();
					}), abortable(function(ex) {
						if (ex.code === ex.NOT_FOUND_ERR) {
							save();
						} else {
							fs_error();
						}
					}));
				}), fs_error);
			}), fs_error);
		}
		, FS_proto = FileSaver.prototype
		, saveAs = function(blob, name) {
			return new FileSaver(blob, name);
		}
	;
	// IE 10+ (native saveAs)
	if (typeof navigator !== "undefined" && navigator.msSaveOrOpenBlob) {
		return function(blob, name) {
			return navigator.msSaveOrOpenBlob(auto_bom(blob), name);
		};
	}

	FS_proto.abort = function() {
		var filesaver = this;
		filesaver.readyState = filesaver.DONE;
		dispatch(filesaver, "abort");
	};
	FS_proto.readyState = FS_proto.INIT = 0;
	FS_proto.WRITING = 1;
	FS_proto.DONE = 2;

	FS_proto.error =
	FS_proto.onwritestart =
	FS_proto.onprogress =
	FS_proto.onwrite =
	FS_proto.onabort =
	FS_proto.onerror =
	FS_proto.onwriteend =
		null;

	return saveAs;
}(
	   typeof self !== "undefined" && self
	|| typeof window !== "undefined" && window
	|| this.content
));
// `self` is undefined in Firefox for Android content script context
// while `this` is nsIContentFrameMessageManager
// with an attribute `content` that corresponds to the window

if (typeof module !== "undefined" && module.exports) {
  module.exports.saveAs = saveAs;
} else if ((typeof define !== "undefined" && define !== null) && (define.amd != null)) {
  define([], function() {
    return saveAs;
  });
};/*!
 * Draggabilly PACKAGED v2.2.0
 * Make that shiz draggable
 * https://draggabilly.desandro.com
 * MIT license
 */

/**
 * Bridget makes jQuery widgets
 * v2.0.1
 * MIT license
 */

/* jshint browser: true, strict: true, undef: true, unused: true */

( function( window, factory ) {
  // universal module definition
  /*jshint strict: false */ /* globals define, module, require */
  if ( typeof define == 'function' && define.amd ) {
    // AMD
    define( 'jquery-bridget/jquery-bridget',[ 'jquery' ], function( jQuery ) {
      return factory( window, jQuery );
    });
  } else if ( typeof module == 'object' && module.exports ) {
    // CommonJS
    module.exports = factory(
      window,
      require('jquery')
    );
  } else {
    // browser global
    window.jQueryBridget = factory(
      window,
      window.jQuery
    );
  }

}( window, function factory( window, jQuery ) {
'use strict';

// ----- utils ----- //

var arraySlice = Array.prototype.slice;

// helper function for logging errors
// $.error breaks jQuery chaining
var console = window.console;
var logError = typeof console == 'undefined' ? function() {} :
  function( message ) {
    console.error( message );
  };

// ----- jQueryBridget ----- //

function jQueryBridget( namespace, PluginClass, $ ) {
  $ = $ || jQuery || window.jQuery;
  if ( !$ ) {
    return;
  }

  // add option method -> $().plugin('option', {...})
  if ( !PluginClass.prototype.option ) {
    // option setter
    PluginClass.prototype.option = function( opts ) {
      // bail out if not an object
      if ( !$.isPlainObject( opts ) ){
        return;
      }
      this.options = $.extend( true, this.options, opts );
    };
  }

  // make jQuery plugin
  $.fn[ namespace ] = function( arg0 /*, arg1 */ ) {
    if ( typeof arg0 == 'string' ) {
      // method call $().plugin( 'methodName', { options } )
      // shift arguments by 1
      var args = arraySlice.call( arguments, 1 );
      return methodCall( this, arg0, args );
    }
    // just $().plugin({ options })
    plainCall( this, arg0 );
    return this;
  };

  // $().plugin('methodName')
  function methodCall( $elems, methodName, args ) {
    var returnValue;
    var pluginMethodStr = '$().' + namespace + '("' + methodName + '")';

    $elems.each( function( i, elem ) {
      // get instance
      var instance = $.data( elem, namespace );
      if ( !instance ) {
        logError( namespace + ' not initialized. Cannot call methods, i.e. ' +
          pluginMethodStr );
        return;
      }

      var method = instance[ methodName ];
      if ( !method || methodName.charAt(0) == '_' ) {
        logError( pluginMethodStr + ' is not a valid method' );
        return;
      }

      // apply method, get return value
      var value = method.apply( instance, args );
      // set return value if value is returned, use only first value
      returnValue = returnValue === undefined ? value : returnValue;
    });

    return returnValue !== undefined ? returnValue : $elems;
  }

  function plainCall( $elems, options ) {
    $elems.each( function( i, elem ) {
      var instance = $.data( elem, namespace );
      if ( instance ) {
        // set options & init
        instance.option( options );
        instance._init();
      } else {
        // initialize new instance
        instance = new PluginClass( elem, options );
        $.data( elem, namespace, instance );
      }
    });
  }

  updateJQuery( $ );

}

// ----- updateJQuery ----- //

// set $.bridget for v1 backwards compatibility
function updateJQuery( $ ) {
  if ( !$ || ( $ && $.bridget ) ) {
    return;
  }
  $.bridget = jQueryBridget;
}

updateJQuery( jQuery || window.jQuery );

// -----  ----- //

return jQueryBridget;

}));

/*!
 * getSize v2.0.2
 * measure size of elements
 * MIT license
 */

/*jshint browser: true, strict: true, undef: true, unused: true */
/*global define: false, module: false, console: false */

( function( window, factory ) {
  'use strict';

  if ( typeof define == 'function' && define.amd ) {
    // AMD
    define( 'get-size/get-size',[],function() {
      return factory();
    });
  } else if ( typeof module == 'object' && module.exports ) {
    // CommonJS
    module.exports = factory();
  } else {
    // browser global
    window.getSize = factory();
  }

})( window, function factory() {
'use strict';

// -------------------------- helpers -------------------------- //

// get a number from a string, not a percentage
function getStyleSize( value ) {
  var num = parseFloat( value );
  // not a percent like '100%', and a number
  var isValid = value.indexOf('%') == -1 && !isNaN( num );
  return isValid && num;
}

function noop() {}

var logError = typeof console == 'undefined' ? noop :
  function( message ) {
    console.error( message );
  };

// -------------------------- measurements -------------------------- //

var measurements = [
  'paddingLeft',
  'paddingRight',
  'paddingTop',
  'paddingBottom',
  'marginLeft',
  'marginRight',
  'marginTop',
  'marginBottom',
  'borderLeftWidth',
  'borderRightWidth',
  'borderTopWidth',
  'borderBottomWidth'
];

var measurementsLength = measurements.length;

function getZeroSize() {
  var size = {
    width: 0,
    height: 0,
    innerWidth: 0,
    innerHeight: 0,
    outerWidth: 0,
    outerHeight: 0
  };
  for ( var i=0; i < measurementsLength; i++ ) {
    var measurement = measurements[i];
    size[ measurement ] = 0;
  }
  return size;
}

// -------------------------- getStyle -------------------------- //

/**
 * getStyle, get style of element, check for Firefox bug
 * https://bugzilla.mozilla.org/show_bug.cgi?id=548397
 */
function getStyle( elem ) {
  var style = getComputedStyle( elem );
  if ( !style ) {
    logError( 'Style returned ' + style +
      '. Are you running this code in a hidden iframe on Firefox? ' +
      'See http://bit.ly/getsizebug1' );
  }
  return style;
}

// -------------------------- setup -------------------------- //

var isSetup = false;

var isBoxSizeOuter;

/**
 * setup
 * check isBoxSizerOuter
 * do on first getSize() rather than on page load for Firefox bug
 */
function setup() {
  // setup once
  if ( isSetup ) {
    return;
  }
  isSetup = true;

  // -------------------------- box sizing -------------------------- //

  /**
   * WebKit measures the outer-width on style.width on border-box elems
   * IE & Firefox<29 measures the inner-width
   */
  var div = document.createElement('div');
  div.style.width = '200px';
  div.style.padding = '1px 2px 3px 4px';
  div.style.borderStyle = 'solid';
  div.style.borderWidth = '1px 2px 3px 4px';
  div.style.boxSizing = 'border-box';

  var body = document.body || document.documentElement;
  body.appendChild( div );
  var style = getStyle( div );

  getSize.isBoxSizeOuter = isBoxSizeOuter = getStyleSize( style.width ) == 200;
  body.removeChild( div );

}

// -------------------------- getSize -------------------------- //

function getSize( elem ) {
  setup();

  // use querySeletor if elem is string
  if ( typeof elem == 'string' ) {
    elem = document.querySelector( elem );
  }

  // do not proceed on non-objects
  if ( !elem || typeof elem != 'object' || !elem.nodeType ) {
    return;
  }

  var style = getStyle( elem );

  // if hidden, everything is 0
  if ( style.display == 'none' ) {
    return getZeroSize();
  }

  var size = {};
  size.width = elem.offsetWidth;
  size.height = elem.offsetHeight;

  var isBorderBox = size.isBorderBox = style.boxSizing == 'border-box';

  // get all measurements
  for ( var i=0; i < measurementsLength; i++ ) {
    var measurement = measurements[i];
    var value = style[ measurement ];
    var num = parseFloat( value );
    // any 'auto', 'medium' value will be 0
    size[ measurement ] = !isNaN( num ) ? num : 0;
  }

  var paddingWidth = size.paddingLeft + size.paddingRight;
  var paddingHeight = size.paddingTop + size.paddingBottom;
  var marginWidth = size.marginLeft + size.marginRight;
  var marginHeight = size.marginTop + size.marginBottom;
  var borderWidth = size.borderLeftWidth + size.borderRightWidth;
  var borderHeight = size.borderTopWidth + size.borderBottomWidth;

  var isBorderBoxSizeOuter = isBorderBox && isBoxSizeOuter;

  // overwrite width and height if we can get it from style
  var styleWidth = getStyleSize( style.width );
  if ( styleWidth !== false ) {
    size.width = styleWidth +
      // add padding and border unless it's already including it
      ( isBorderBoxSizeOuter ? 0 : paddingWidth + borderWidth );
  }

  var styleHeight = getStyleSize( style.height );
  if ( styleHeight !== false ) {
    size.height = styleHeight +
      // add padding and border unless it's already including it
      ( isBorderBoxSizeOuter ? 0 : paddingHeight + borderHeight );
  }

  size.innerWidth = size.width - ( paddingWidth + borderWidth );
  size.innerHeight = size.height - ( paddingHeight + borderHeight );

  size.outerWidth = size.width + marginWidth;
  size.outerHeight = size.height + marginHeight;

  return size;
}

return getSize;

});

/**
 * EvEmitter v1.1.0
 * Lil' event emitter
 * MIT License
 */

/* jshint unused: true, undef: true, strict: true */

( function( global, factory ) {
  // universal module definition
  /* jshint strict: false */ /* globals define, module, window */
  if ( typeof define == 'function' && define.amd ) {
    // AMD - RequireJS
    define( 'ev-emitter/ev-emitter',factory );
  } else if ( typeof module == 'object' && module.exports ) {
    // CommonJS - Browserify, Webpack
    module.exports = factory();
  } else {
    // Browser globals
    global.EvEmitter = factory();
  }

}( typeof window != 'undefined' ? window : this, function() {



function EvEmitter() {}

var proto = EvEmitter.prototype;

proto.on = function( eventName, listener ) {
  if ( !eventName || !listener ) {
    return;
  }
  // set events hash
  var events = this._events = this._events || {};
  // set listeners array
  var listeners = events[ eventName ] = events[ eventName ] || [];
  // only add once
  if ( listeners.indexOf( listener ) == -1 ) {
    listeners.push( listener );
  }

  return this;
};

proto.once = function( eventName, listener ) {
  if ( !eventName || !listener ) {
    return;
  }
  // add event
  this.on( eventName, listener );
  // set once flag
  // set onceEvents hash
  var onceEvents = this._onceEvents = this._onceEvents || {};
  // set onceListeners object
  var onceListeners = onceEvents[ eventName ] = onceEvents[ eventName ] || {};
  // set flag
  onceListeners[ listener ] = true;

  return this;
};

proto.off = function( eventName, listener ) {
  var listeners = this._events && this._events[ eventName ];
  if ( !listeners || !listeners.length ) {
    return;
  }
  var index = listeners.indexOf( listener );
  if ( index != -1 ) {
    listeners.splice( index, 1 );
  }

  return this;
};

proto.emitEvent = function( eventName, args ) {
  var listeners = this._events && this._events[ eventName ];
  if ( !listeners || !listeners.length ) {
    return;
  }
  // copy over to avoid interference if .off() in listener
  listeners = listeners.slice(0);
  args = args || [];
  // once stuff
  var onceListeners = this._onceEvents && this._onceEvents[ eventName ];

  for ( var i=0; i < listeners.length; i++ ) {
    var listener = listeners[i]
    var isOnce = onceListeners && onceListeners[ listener ];
    if ( isOnce ) {
      // remove listener
      // remove before trigger to prevent recursion
      this.off( eventName, listener );
      // unset once flag
      delete onceListeners[ listener ];
    }
    // trigger listener
    listener.apply( this, args );
  }

  return this;
};

proto.allOff = function() {
  delete this._events;
  delete this._onceEvents;
};

return EvEmitter;

}));

/*!
 * Unipointer v2.3.0
 * base class for doing one thing with pointer event
 * MIT license
 */

/*jshint browser: true, undef: true, unused: true, strict: true */

( function( window, factory ) {
  // universal module definition
  /* jshint strict: false */ /*global define, module, require */
  if ( typeof define == 'function' && define.amd ) {
    // AMD
    define( 'unipointer/unipointer',[
      'ev-emitter/ev-emitter'
    ], function( EvEmitter ) {
      return factory( window, EvEmitter );
    });
  } else if ( typeof module == 'object' && module.exports ) {
    // CommonJS
    module.exports = factory(
      window,
      require('ev-emitter')
    );
  } else {
    // browser global
    window.Unipointer = factory(
      window,
      window.EvEmitter
    );
  }

}( window, function factory( window, EvEmitter ) {



function noop() {}

function Unipointer() {}

// inherit EvEmitter
var proto = Unipointer.prototype = Object.create( EvEmitter.prototype );

proto.bindStartEvent = function( elem ) {
  this._bindStartEvent( elem, true );
};

proto.unbindStartEvent = function( elem ) {
  this._bindStartEvent( elem, false );
};

/**
 * Add or remove start event
 * @param {Boolean} isAdd - remove if falsey
 */
proto._bindStartEvent = function( elem, isAdd ) {
  // munge isAdd, default to true
  isAdd = isAdd === undefined ? true : isAdd;
  var bindMethod = isAdd ? 'addEventListener' : 'removeEventListener';

  // default to mouse events
  var startEvent = 'mousedown';
  if ( window.PointerEvent ) {
    // Pointer Events
    startEvent = 'pointerdown';
  } else if ( 'ontouchstart' in window ) {
    // Touch Events. iOS Safari
    startEvent = 'touchstart';
  }
  elem[ bindMethod ]( startEvent, this );
};

// trigger handler methods for events
proto.handleEvent = function( event ) {
  var method = 'on' + event.type;
  if ( this[ method ] ) {
    this[ method ]( event );
  }
};

// returns the touch that we're keeping track of
proto.getTouch = function( touches ) {
  for ( var i=0; i < touches.length; i++ ) {
    var touch = touches[i];
    if ( touch.identifier == this.pointerIdentifier ) {
      return touch;
    }
  }
};

// ----- start event ----- //

proto.onmousedown = function( event ) {
  // dismiss clicks from right or middle buttons
  var button = event.button;
  if ( button && ( button !== 0 && button !== 1 ) ) {
    return;
  }
  this._pointerDown( event, event );
};

proto.ontouchstart = function( event ) {
  this._pointerDown( event, event.changedTouches[0] );
};

proto.onpointerdown = function( event ) {
  this._pointerDown( event, event );
};

/**
 * pointer start
 * @param {Event} event
 * @param {Event or Touch} pointer
 */
proto._pointerDown = function( event, pointer ) {
  // dismiss right click and other pointers
  // button = 0 is okay, 1-4 not
  if ( event.button || this.isPointerDown ) {
    return;
  }

  this.isPointerDown = true;
  // save pointer identifier to match up touch events
  this.pointerIdentifier = pointer.pointerId !== undefined ?
    // pointerId for pointer events, touch.indentifier for touch events
    pointer.pointerId : pointer.identifier;

  this.pointerDown( event, pointer );
};

proto.pointerDown = function( event, pointer ) {
  this._bindPostStartEvents( event );
  this.emitEvent( 'pointerDown', [ event, pointer ] );
};

// hash of events to be bound after start event
var postStartEvents = {
  mousedown: [ 'mousemove', 'mouseup' ],
  touchstart: [ 'touchmove', 'touchend', 'touchcancel' ],
  pointerdown: [ 'pointermove', 'pointerup', 'pointercancel' ],
};

proto._bindPostStartEvents = function( event ) {
  if ( !event ) {
    return;
  }
  // get proper events to match start event
  var events = postStartEvents[ event.type ];
  // bind events to node
  events.forEach( function( eventName ) {
    window.addEventListener( eventName, this );
  }, this );
  // save these arguments
  this._boundPointerEvents = events;
};

proto._unbindPostStartEvents = function() {
  // check for _boundEvents, in case dragEnd triggered twice (old IE8 bug)
  if ( !this._boundPointerEvents ) {
    return;
  }
  this._boundPointerEvents.forEach( function( eventName ) {
    window.removeEventListener( eventName, this );
  }, this );

  delete this._boundPointerEvents;
};

// ----- move event ----- //

proto.onmousemove = function( event ) {
  this._pointerMove( event, event );
};

proto.onpointermove = function( event ) {
  if ( event.pointerId == this.pointerIdentifier ) {
    this._pointerMove( event, event );
  }
};

proto.ontouchmove = function( event ) {
  var touch = this.getTouch( event.changedTouches );
  if ( touch ) {
    this._pointerMove( event, touch );
  }
};

/**
 * pointer move
 * @param {Event} event
 * @param {Event or Touch} pointer
 * @private
 */
proto._pointerMove = function( event, pointer ) {
  this.pointerMove( event, pointer );
};

// public
proto.pointerMove = function( event, pointer ) {
  this.emitEvent( 'pointerMove', [ event, pointer ] );
};

// ----- end event ----- //


proto.onmouseup = function( event ) {
  this._pointerUp( event, event );
};

proto.onpointerup = function( event ) {
  if ( event.pointerId == this.pointerIdentifier ) {
    this._pointerUp( event, event );
  }
};

proto.ontouchend = function( event ) {
  var touch = this.getTouch( event.changedTouches );
  if ( touch ) {
    this._pointerUp( event, touch );
  }
};

/**
 * pointer up
 * @param {Event} event
 * @param {Event or Touch} pointer
 * @private
 */
proto._pointerUp = function( event, pointer ) {
  this._pointerDone();
  this.pointerUp( event, pointer );
};

// public
proto.pointerUp = function( event, pointer ) {
  this.emitEvent( 'pointerUp', [ event, pointer ] );
};

// ----- pointer done ----- //

// triggered on pointer up & pointer cancel
proto._pointerDone = function() {
  this._pointerReset();
  this._unbindPostStartEvents();
  this.pointerDone();
};

proto._pointerReset = function() {
  // reset properties
  this.isPointerDown = false;
  delete this.pointerIdentifier;
};

proto.pointerDone = noop;

// ----- pointer cancel ----- //

proto.onpointercancel = function( event ) {
  if ( event.pointerId == this.pointerIdentifier ) {
    this._pointerCancel( event, event );
  }
};

proto.ontouchcancel = function( event ) {
  var touch = this.getTouch( event.changedTouches );
  if ( touch ) {
    this._pointerCancel( event, touch );
  }
};

/**
 * pointer cancel
 * @param {Event} event
 * @param {Event or Touch} pointer
 * @private
 */
proto._pointerCancel = function( event, pointer ) {
  this._pointerDone();
  this.pointerCancel( event, pointer );
};

// public
proto.pointerCancel = function( event, pointer ) {
  this.emitEvent( 'pointerCancel', [ event, pointer ] );
};

// -----  ----- //

// utility function for getting x/y coords from event
Unipointer.getPointerPoint = function( pointer ) {
  return {
    x: pointer.pageX,
    y: pointer.pageY
  };
};

// -----  ----- //

return Unipointer;

}));

/*!
 * Unidragger v2.3.0
 * Draggable base class
 * MIT license
 */

/*jshint browser: true, unused: true, undef: true, strict: true */

( function( window, factory ) {
  // universal module definition
  /*jshint strict: false */ /*globals define, module, require */

  if ( typeof define == 'function' && define.amd ) {
    // AMD
    define( 'unidragger/unidragger',[
      'unipointer/unipointer'
    ], function( Unipointer ) {
      return factory( window, Unipointer );
    });
  } else if ( typeof module == 'object' && module.exports ) {
    // CommonJS
    module.exports = factory(
      window,
      require('unipointer')
    );
  } else {
    // browser global
    window.Unidragger = factory(
      window,
      window.Unipointer
    );
  }

}( window, function factory( window, Unipointer ) {



// -------------------------- Unidragger -------------------------- //

function Unidragger() {}

// inherit Unipointer & EvEmitter
var proto = Unidragger.prototype = Object.create( Unipointer.prototype );

// ----- bind start ----- //

proto.bindHandles = function() {
  this._bindHandles( true );
};

proto.unbindHandles = function() {
  this._bindHandles( false );
};

/**
 * Add or remove start event
 * @param {Boolean} isAdd
 */
proto._bindHandles = function( isAdd ) {
  // munge isAdd, default to true
  isAdd = isAdd === undefined ? true : isAdd;
  // bind each handle
  var bindMethod = isAdd ? 'addEventListener' : 'removeEventListener';
  var touchAction = isAdd ? this._touchActionValue : '';
  for ( var i=0; i < this.handles.length; i++ ) {
    var handle = this.handles[i];
    this._bindStartEvent( handle, isAdd );
    handle[ bindMethod ]( 'click', this );
    // touch-action: none to override browser touch gestures. metafizzy/flickity#540
    if ( window.PointerEvent ) {
      handle.style.touchAction = touchAction;
    }
  }
};

// prototype so it can be overwriteable by Flickity
proto._touchActionValue = 'none';

// ----- start event ----- //

/**
 * pointer start
 * @param {Event} event
 * @param {Event or Touch} pointer
 */
proto.pointerDown = function( event, pointer ) {
  var isOkay = this.okayPointerDown( event );
  if ( !isOkay ) {
    return;
  }
  // track start event position
  this.pointerDownPointer = pointer;

  event.preventDefault();
  this.pointerDownBlur();
  // bind move and end events
  this._bindPostStartEvents( event );
  this.emitEvent( 'pointerDown', [ event, pointer ] );
};

// nodes that have text fields
var cursorNodes = {
  TEXTAREA: true,
  INPUT: true,
  SELECT: true,
  OPTION: true,
};

// input types that do not have text fields
var clickTypes = {
  radio: true,
  checkbox: true,
  button: true,
  submit: true,
  image: true,
  file: true,
};

// dismiss inputs with text fields. flickity#403, flickity#404
proto.okayPointerDown = function( event ) {
  var isCursorNode = cursorNodes[ event.target.nodeName ];
  var isClickType = clickTypes[ event.target.type ];
  var isOkay = !isCursorNode || isClickType;
  if ( !isOkay ) {
    this._pointerReset();
  }
  return isOkay;
};

// kludge to blur previously focused input
proto.pointerDownBlur = function() {
  var focused = document.activeElement;
  // do not blur body for IE10, metafizzy/flickity#117
  var canBlur = focused && focused.blur && focused != document.body;
  if ( canBlur ) {
    focused.blur();
  }
};

// ----- move event ----- //

/**
 * drag move
 * @param {Event} event
 * @param {Event or Touch} pointer
 */
proto.pointerMove = function( event, pointer ) {
  var moveVector = this._dragPointerMove( event, pointer );
  this.emitEvent( 'pointerMove', [ event, pointer, moveVector ] );
  this._dragMove( event, pointer, moveVector );
};

// base pointer move logic
proto._dragPointerMove = function( event, pointer ) {
  var moveVector = {
    x: pointer.pageX - this.pointerDownPointer.pageX,
    y: pointer.pageY - this.pointerDownPointer.pageY
  };
  // start drag if pointer has moved far enough to start drag
  if ( !this.isDragging && this.hasDragStarted( moveVector ) ) {
    this._dragStart( event, pointer );
  }
  return moveVector;
};

// condition if pointer has moved far enough to start drag
proto.hasDragStarted = function( moveVector ) {
  return Math.abs( moveVector.x ) > 3 || Math.abs( moveVector.y ) > 3;
};

// ----- end event ----- //

/**
 * pointer up
 * @param {Event} event
 * @param {Event or Touch} pointer
 */
proto.pointerUp = function( event, pointer ) {
  this.emitEvent( 'pointerUp', [ event, pointer ] );
  this._dragPointerUp( event, pointer );
};

proto._dragPointerUp = function( event, pointer ) {
  if ( this.isDragging ) {
    this._dragEnd( event, pointer );
  } else {
    // pointer didn't move enough for drag to start
    this._staticClick( event, pointer );
  }
};

// -------------------------- drag -------------------------- //

// dragStart
proto._dragStart = function( event, pointer ) {
  this.isDragging = true;
  // prevent clicks
  this.isPreventingClicks = true;
  this.dragStart( event, pointer );
};

proto.dragStart = function( event, pointer ) {
  this.emitEvent( 'dragStart', [ event, pointer ] );
};

// dragMove
proto._dragMove = function( event, pointer, moveVector ) {
  // do not drag if not dragging yet
  if ( !this.isDragging ) {
    return;
  }

  this.dragMove( event, pointer, moveVector );
};

proto.dragMove = function( event, pointer, moveVector ) {
  event.preventDefault();
  this.emitEvent( 'dragMove', [ event, pointer, moveVector ] );
};

// dragEnd
proto._dragEnd = function( event, pointer ) {
  // set flags
  this.isDragging = false;
  // re-enable clicking async
  setTimeout( function() {
    delete this.isPreventingClicks;
  }.bind( this ) );

  this.dragEnd( event, pointer );
};

proto.dragEnd = function( event, pointer ) {
  this.emitEvent( 'dragEnd', [ event, pointer ] );
};

// ----- onclick ----- //

// handle all clicks and prevent clicks when dragging
proto.onclick = function( event ) {
  if ( this.isPreventingClicks ) {
    event.preventDefault();
  }
};

// ----- staticClick ----- //

// triggered after pointer down & up with no/tiny movement
proto._staticClick = function( event, pointer ) {
  // ignore emulated mouse up clicks
  if ( this.isIgnoringMouseUp && event.type == 'mouseup' ) {
    return;
  }

  this.staticClick( event, pointer );

  // set flag for emulated clicks 300ms after touchend
  if ( event.type != 'mouseup' ) {
    this.isIgnoringMouseUp = true;
    // reset flag after 300ms
    setTimeout( function() {
      delete this.isIgnoringMouseUp;
    }.bind( this ), 400 );
  }
};

proto.staticClick = function( event, pointer ) {
  this.emitEvent( 'staticClick', [ event, pointer ] );
};

// ----- utils ----- //

Unidragger.getPointerPoint = Unipointer.getPointerPoint;

// -----  ----- //

return Unidragger;

}));

/*!
 * Draggabilly v2.2.0
 * Make that shiz draggable
 * https://draggabilly.desandro.com
 * MIT license
 */

/*jshint browser: true, strict: true, undef: true, unused: true */

( function( window, factory ) {
  // universal module definition
  /* jshint strict: false */ /*globals define, module, require */
  if ( typeof define == 'function' && define.amd ) {
    // AMD
    define( [
        'get-size/get-size',
        'unidragger/unidragger'
      ],
      function( getSize, Unidragger ) {
        return factory( window, getSize, Unidragger );
      });
  } else if ( typeof module == 'object' && module.exports ) {
    // CommonJS
    module.exports = factory(
      window,
      require('get-size'),
      require('unidragger')
    );
  } else {
    // browser global
    window.Draggabilly = factory(
      window,
      window.getSize,
      window.Unidragger
    );
  }

}( window, function factory( window, getSize, Unidragger ) {



// -------------------------- helpers & variables -------------------------- //

// extend objects
function extend( a, b ) {
  for ( var prop in b ) {
    a[ prop ] = b[ prop ];
  }
  return a;
}

function noop() {}

var jQuery = window.jQuery;

// --------------------------  -------------------------- //

function Draggabilly( element, options ) {
  // querySelector if string
  this.element = typeof element == 'string' ?
    document.querySelector( element ) : element;

  if ( jQuery ) {
    this.$element = jQuery( this.element );
  }

  // options
  this.options = extend( {}, this.constructor.defaults );
  this.option( options );

  this._create();
}

// inherit Unidragger methods
var proto = Draggabilly.prototype = Object.create( Unidragger.prototype );

Draggabilly.defaults = {
};

/**
 * set options
 * @param {Object} opts
 */
proto.option = function( opts ) {
  extend( this.options, opts );
};

// css position values that don't need to be set
var positionValues = {
  relative: true,
  absolute: true,
  fixed: true
};

proto._create = function() {
  // properties
  this.position = {};
  this._getPosition();

  this.startPoint = { x: 0, y: 0 };
  this.dragPoint = { x: 0, y: 0 };

  this.startPosition = extend( {}, this.position );

  // set relative positioning
  var style = getComputedStyle( this.element );
  if ( !positionValues[ style.position ] ) {
    this.element.style.position = 'relative';
  }

  // events, bridge jQuery events from vanilla
  this.on( 'pointerDown', this.onPointerDown );
  this.on( 'pointerMove', this.onPointerMove );
  this.on( 'pointerUp', this.onPointerUp );

  this.enable();
  this.setHandles();
};

/**
 * set this.handles and bind start events to 'em
 */
proto.setHandles = function() {
  this.handles = this.options.handle ?
    this.element.querySelectorAll( this.options.handle ) : [ this.element ];

  this.bindHandles();
};

/**
 * emits events via EvEmitter and jQuery events
 * @param {String} type - name of event
 * @param {Event} event - original event
 * @param {Array} args - extra arguments
 */
proto.dispatchEvent = function( type, event, args ) {
  var emitArgs = [ event ].concat( args );
  this.emitEvent( type, emitArgs );
  this.dispatchJQueryEvent( type, event, args );
};

proto.dispatchJQueryEvent = function( type, event, args ) {
  var jQuery = window.jQuery;
  // trigger jQuery event
  if ( !jQuery || !this.$element ) {
    return;
  }
  // create jQuery event
  var $event = jQuery.Event( event );
  $event.type = type;
  this.$element.trigger( $event, args );
};

// -------------------------- position -------------------------- //

// get x/y position from style
proto._getPosition = function() {
  var style = getComputedStyle( this.element );
  var x = this._getPositionCoord( style.left, 'width' );
  var y = this._getPositionCoord( style.top, 'height' );
  // clean up 'auto' or other non-integer values
  this.position.x = isNaN( x ) ? 0 : x;
  this.position.y = isNaN( y ) ? 0 : y;

  this._addTransformPosition( style );
};

proto._getPositionCoord = function( styleSide, measure ) {
  if ( styleSide.indexOf('%') != -1 ) {
    // convert percent into pixel for Safari, #75
    var parentSize = getSize( this.element.parentNode );
    // prevent not-in-DOM element throwing bug, #131
    return !parentSize ? 0 :
      ( parseFloat( styleSide ) / 100 ) * parentSize[ measure ];
  }
  return parseInt( styleSide, 10 );
};

// add transform: translate( x, y ) to position
proto._addTransformPosition = function( style ) {
  var transform = style.transform;
  // bail out if value is 'none'
  if ( transform.indexOf('matrix') !== 0 ) {
    return;
  }
  // split matrix(1, 0, 0, 1, x, y)
  var matrixValues = transform.split(',');
  // translate X value is in 12th or 4th position
  var xIndex = transform.indexOf('matrix3d') === 0 ? 12 : 4;
  var translateX = parseInt( matrixValues[ xIndex ], 10 );
  // translate Y value is in 13th or 5th position
  var translateY = parseInt( matrixValues[ xIndex + 1 ], 10 );
  this.position.x += translateX;
  this.position.y += translateY;
};

// -------------------------- events -------------------------- //

proto.onPointerDown = function( event, pointer ) {
  this.element.classList.add('is-pointer-down');
  this.dispatchJQueryEvent( 'pointerDown', event, [ pointer ] );
};

/**
 * drag start
 * @param {Event} event
 * @param {Event or Touch} pointer
 */
proto.dragStart = function( event, pointer ) {
  if ( !this.isEnabled ) {
    return;
  }
  this._getPosition();
  this.measureContainment();
  // position _when_ drag began
  this.startPosition.x = this.position.x;
  this.startPosition.y = this.position.y;
  // reset left/top style
  this.setLeftTop();

  this.dragPoint.x = 0;
  this.dragPoint.y = 0;

  this.element.classList.add('is-dragging');
  this.dispatchEvent( 'dragStart', event, [ pointer ] );
  // start animation
  this.animate();
};

proto.measureContainment = function() {
  var container = this.getContainer();
  if ( !container ) {
    return;
  }

  var elemSize = getSize( this.element );
  var containerSize = getSize( container );
  var elemRect = this.element.getBoundingClientRect();
  var containerRect = container.getBoundingClientRect();

  var borderSizeX = containerSize.borderLeftWidth + containerSize.borderRightWidth;
  var borderSizeY = containerSize.borderTopWidth + containerSize.borderBottomWidth;

  var position = this.relativeStartPosition = {
    x: elemRect.left - ( containerRect.left + containerSize.borderLeftWidth ),
    y: elemRect.top - ( containerRect.top + containerSize.borderTopWidth )
  };

  this.containSize = {
    width: ( containerSize.width - borderSizeX ) - position.x - elemSize.width,
    height: ( containerSize.height - borderSizeY ) - position.y - elemSize.height
  };
};

proto.getContainer = function() {
  var containment = this.options.containment;
  if ( !containment ) {
    return;
  }
  var isElement = containment instanceof HTMLElement;
  // use as element
  if ( isElement ) {
    return containment;
  }
  // querySelector if string
  if ( typeof containment == 'string' ) {
    return document.querySelector( containment );
  }
  // fallback to parent element
  return this.element.parentNode;
};

// ----- move event ----- //

proto.onPointerMove = function( event, pointer, moveVector ) {
  this.dispatchJQueryEvent( 'pointerMove', event, [ pointer, moveVector ] );
};

/**
 * drag move
 * @param {Event} event
 * @param {Event or Touch} pointer
 */
proto.dragMove = function( event, pointer, moveVector ) {
  if ( !this.isEnabled ) {
    return;
  }
  var dragX = moveVector.x;
  var dragY = moveVector.y;

  var grid = this.options.grid;
  var gridX = grid && grid[0];
  var gridY = grid && grid[1];

  dragX = applyGrid( dragX, gridX );
  dragY = applyGrid( dragY, gridY );

  dragX = this.containDrag( 'x', dragX, gridX );
  dragY = this.containDrag( 'y', dragY, gridY );

  // constrain to axis
  dragX = this.options.axis == 'y' ? 0 : dragX;
  dragY = this.options.axis == 'x' ? 0 : dragY;

  this.position.x = this.startPosition.x + dragX;
  this.position.y = this.startPosition.y + dragY;
  // set dragPoint properties
  this.dragPoint.x = dragX;
  this.dragPoint.y = dragY;

  this.dispatchEvent( 'dragMove', event, [ pointer, moveVector ] );
};

function applyGrid( value, grid, method ) {
  method = method || 'round';
  return grid ? Math[ method ]( value / grid ) * grid : value;
}

proto.containDrag = function( axis, drag, grid ) {
  if ( !this.options.containment ) {
    return drag;
  }
  var measure = axis == 'x' ? 'width' : 'height';

  var rel = this.relativeStartPosition[ axis ];
  var min = applyGrid( -rel, grid, 'ceil' );
  var max = this.containSize[ measure ];
  max = applyGrid( max, grid, 'floor' );
  return  Math.max( min, Math.min( max, drag ) );
};

// ----- end event ----- //

/**
 * pointer up
 * @param {Event} event
 * @param {Event or Touch} pointer
 */
proto.onPointerUp = function( event, pointer ) {
  this.element.classList.remove('is-pointer-down');
  this.dispatchJQueryEvent( 'pointerUp', event, [ pointer ] );
};

/**
 * drag end
 * @param {Event} event
 * @param {Event or Touch} pointer
 */
proto.dragEnd = function( event, pointer ) {
  if ( !this.isEnabled ) {
    return;
  }
  // use top left position when complete
  this.element.style.transform = '';
  this.setLeftTop();
  this.element.classList.remove('is-dragging');
  this.dispatchEvent( 'dragEnd', event, [ pointer ] );
};

// -------------------------- animation -------------------------- //

proto.animate = function() {
  // only render and animate if dragging
  if ( !this.isDragging ) {
    return;
  }

  this.positionDrag();

  var _this = this;
  requestAnimationFrame( function animateFrame() {
    _this.animate();
  });

};

// left/top positioning
proto.setLeftTop = function() {
  this.element.style.left = this.position.x + 'px';
  this.element.style.top  = this.position.y + 'px';
};

proto.positionDrag = function() {
  this.element.style.transform = 'translate3d( ' + this.dragPoint.x +
    'px, ' + this.dragPoint.y + 'px, 0)';
};

// ----- staticClick ----- //

proto.staticClick = function( event, pointer ) {
  this.dispatchEvent( 'staticClick', event, [ pointer ] );
};

// ----- methods ----- //

/**
 * @param {Number} x
 * @param {Number} y
 */
proto.setPosition = function( x, y ) {
  this.position.x = x;
  this.position.y = y;
  this.setLeftTop();
};

proto.enable = function() {
  this.isEnabled = true;
};

proto.disable = function() {
  this.isEnabled = false;
  if ( this.isDragging ) {
    this.dragEnd();
  }
};

proto.destroy = function() {
  this.disable();
  // reset styles
  this.element.style.transform = '';
  this.element.style.left = '';
  this.element.style.top = '';
  this.element.style.position = '';
  // unbind handles
  this.unbindHandles();
  // remove jQuery data
  if ( this.$element ) {
    this.$element.removeData('draggabilly');
  }
};

// ----- jQuery bridget ----- //

// required for jQuery bridget
proto._init = noop;

if ( jQuery && jQuery.bridget ) {
  jQuery.bridget( 'draggabilly', Draggabilly );
}

// -----  ----- //

return Draggabilly;

}));

;!function(e){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=e();else if("function"==typeof define&&define.amd)define([],e);else{("undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof self?self:this).markdownit=e()}}((function(){return function e(r,t,n){function s(i,a){if(!t[i]){if(!r[i]){var c="function"==typeof require&&require;if(!a&&c)return c(i,!0);if(o)return o(i,!0);var l=new Error("Cannot find module '"+i+"'");throw l.code="MODULE_NOT_FOUND",l}var u=t[i]={exports:{}};r[i][0].call(u.exports,(function(e){return s(r[i][1][e]||e)}),u,u.exports,e,r,t,n)}return t[i].exports}for(var o="function"==typeof require&&require,i=0;i<n.length;i++)s(n[i]);return s}({1:[function(e,r,t){"use strict";r.exports=e("entities/lib/maps/entities.json")},{"entities/lib/maps/entities.json":52}],2:[function(e,r,t){"use strict";r.exports=["address","article","aside","base","basefont","blockquote","body","caption","center","col","colgroup","dd","details","dialog","dir","div","dl","dt","fieldset","figcaption","figure","footer","form","frame","frameset","h1","h2","h3","h4","h5","h6","head","header","hr","html","iframe","legend","li","link","main","menu","menuitem","meta","nav","noframes","ol","optgroup","option","p","param","section","source","summary","table","tbody","td","tfoot","th","thead","title","tr","track","ul"]},{}],3:[function(e,r,t){"use strict";var n="<[A-Za-z][A-Za-z0-9\\-]*(?:\\s+[a-zA-Z_:][a-zA-Z0-9:._-]*(?:\\s*=\\s*(?:[^\"'=<>`\\x00-\\x20]+|'[^']*'|\"[^\"]*\"))?)*\\s*\\/?>",s="<\\/[A-Za-z][A-Za-z0-9\\-]*\\s*>",o=new RegExp("^(?:"+n+"|"+s+"|\x3c!----\x3e|\x3c!--(?:-?[^>-])(?:-?[^-])*--\x3e|<[?].*?[?]>|<![A-Z]+\\s+[^>]*>|<!\\[CDATA\\[[\\s\\S]*?\\]\\]>)"),i=new RegExp("^(?:"+n+"|"+s+")");r.exports.HTML_TAG_RE=o,r.exports.HTML_OPEN_CLOSE_TAG_RE=i},{}],4:[function(e,r,t){"use strict";var n=Object.prototype.hasOwnProperty;function s(e,r){return n.call(e,r)}function o(e){return!(e>=55296&&e<=57343)&&(!(e>=64976&&e<=65007)&&(65535!=(65535&e)&&65534!=(65535&e)&&(!(e>=0&&e<=8)&&(11!==e&&(!(e>=14&&e<=31)&&(!(e>=127&&e<=159)&&!(e>1114111)))))))}function i(e){if(e>65535){var r=55296+((e-=65536)>>10),t=56320+(1023&e);return String.fromCharCode(r,t)}return String.fromCharCode(e)}var a=/\\([!"#$%&'()*+,\-.\/:;<=>?@[\\\]^_`{|}~])/g,c=new RegExp(a.source+"|"+/&([a-z#][a-z0-9]{1,31});/gi.source,"gi"),l=/^#((?:x[a-f0-9]{1,8}|[0-9]{1,8}))/i,u=e("./entities");var p=/[&<>"]/,h=/[&<>"]/g,f={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"};function d(e){return f[e]}var m=/[.?*+^$[\]\\(){}|-]/g;var _=e("uc.micro/categories/P/regex");t.lib={},t.lib.mdurl=e("mdurl"),t.lib.ucmicro=e("uc.micro"),t.assign=function(e){return Array.prototype.slice.call(arguments,1).forEach((function(r){if(r){if("object"!=typeof r)throw new TypeError(r+"must be object");Object.keys(r).forEach((function(t){e[t]=r[t]}))}})),e},t.isString=function(e){return"[object String]"===function(e){return Object.prototype.toString.call(e)}(e)},t.has=s,t.unescapeMd=function(e){return e.indexOf("\\")<0?e:e.replace(a,"$1")},t.unescapeAll=function(e){return e.indexOf("\\")<0&&e.indexOf("&")<0?e:e.replace(c,(function(e,r,t){return r||function(e,r){var t=0;return s(u,r)?u[r]:35===r.charCodeAt(0)&&l.test(r)&&o(t="x"===r[1].toLowerCase()?parseInt(r.slice(2),16):parseInt(r.slice(1),10))?i(t):e}(e,t)}))},t.isValidEntityCode=o,t.fromCodePoint=i,t.escapeHtml=function(e){return p.test(e)?e.replace(h,d):e},t.arrayReplaceAt=function(e,r,t){return[].concat(e.slice(0,r),t,e.slice(r+1))},t.isSpace=function(e){switch(e){case 9:case 32:return!0}return!1},t.isWhiteSpace=function(e){if(e>=8192&&e<=8202)return!0;switch(e){case 9:case 10:case 11:case 12:case 13:case 32:case 160:case 5760:case 8239:case 8287:case 12288:return!0}return!1},t.isMdAsciiPunct=function(e){switch(e){case 33:case 34:case 35:case 36:case 37:case 38:case 39:case 40:case 41:case 42:case 43:case 44:case 45:case 46:case 47:case 58:case 59:case 60:case 61:case 62:case 63:case 64:case 91:case 92:case 93:case 94:case 95:case 96:case 123:case 124:case 125:case 126:return!0;default:return!1}},t.isPunctChar=function(e){return _.test(e)},t.escapeRE=function(e){return e.replace(m,"\\$&")},t.normalizeReference=function(e){return e=e.trim().replace(/\s+/g," "),"\u1e7e"==="\u1e9e".toLowerCase()&&(e=e.replace(/\u1e9e/g,"\xdf")),e.toLowerCase().toUpperCase()}},{"./entities":1,mdurl:58,"uc.micro":65,"uc.micro/categories/P/regex":63}],5:[function(e,r,t){"use strict";t.parseLinkLabel=e("./parse_link_label"),t.parseLinkDestination=e("./parse_link_destination"),t.parseLinkTitle=e("./parse_link_title")},{"./parse_link_destination":6,"./parse_link_label":7,"./parse_link_title":8}],6:[function(e,r,t){"use strict";var n=e("../common/utils").unescapeAll;r.exports=function(e,r,t){var s,o,i=r,a={ok:!1,pos:0,lines:0,str:""};if(60===e.charCodeAt(r)){for(r++;r<t;){if(10===(s=e.charCodeAt(r)))return a;if(62===s)return a.pos=r+1,a.str=n(e.slice(i+1,r)),a.ok=!0,a;92===s&&r+1<t?r+=2:r++}return a}for(o=0;r<t&&32!==(s=e.charCodeAt(r))&&!(s<32||127===s);)if(92===s&&r+1<t)r+=2;else{if(40===s&&o++,41===s){if(0===o)break;o--}r++}return i===r?a:0!==o?a:(a.str=n(e.slice(i,r)),a.lines=0,a.pos=r,a.ok=!0,a)}},{"../common/utils":4}],7:[function(e,r,t){"use strict";r.exports=function(e,r,t){var n,s,o,i,a=-1,c=e.posMax,l=e.pos;for(e.pos=r+1,n=1;e.pos<c;){if(93===(o=e.src.charCodeAt(e.pos))&&0===--n){s=!0;break}if(i=e.pos,e.md.inline.skipToken(e),91===o)if(i===e.pos-1)n++;else if(t)return e.pos=l,-1}return s&&(a=e.pos),e.pos=l,a}},{}],8:[function(e,r,t){"use strict";var n=e("../common/utils").unescapeAll;r.exports=function(e,r,t){var s,o,i=0,a=r,c={ok:!1,pos:0,lines:0,str:""};if(r>=t)return c;if(34!==(o=e.charCodeAt(r))&&39!==o&&40!==o)return c;for(r++,40===o&&(o=41);r<t;){if((s=e.charCodeAt(r))===o)return c.pos=r+1,c.lines=i,c.str=n(e.slice(a+1,r)),c.ok=!0,c;10===s?i++:92===s&&r+1<t&&(r++,10===e.charCodeAt(r)&&i++),r++}return c}},{"../common/utils":4}],9:[function(e,r,t){"use strict";var n=e("./common/utils"),s=e("./helpers"),o=e("./renderer"),i=e("./parser_core"),a=e("./parser_block"),c=e("./parser_inline"),l=e("linkify-it"),u=e("mdurl"),p=e("punycode"),h={default:e("./presets/default"),zero:e("./presets/zero"),commonmark:e("./presets/commonmark")},f=/^(vbscript|javascript|file|data):/,d=/^data:image\/(gif|png|jpeg|webp);/;function m(e){var r=e.trim().toLowerCase();return!f.test(r)||!!d.test(r)}var _=["http:","https:","mailto:"];function g(e){var r=u.parse(e,!0);if(r.hostname&&(!r.protocol||_.indexOf(r.protocol)>=0))try{r.hostname=p.toASCII(r.hostname)}catch(e){}return u.encode(u.format(r))}function k(e){var r=u.parse(e,!0);if(r.hostname&&(!r.protocol||_.indexOf(r.protocol)>=0))try{r.hostname=p.toUnicode(r.hostname)}catch(e){}return u.decode(u.format(r))}function b(e,r){if(!(this instanceof b))return new b(e,r);r||n.isString(e)||(r=e||{},e="default"),this.inline=new c,this.block=new a,this.core=new i,this.renderer=new o,this.linkify=new l,this.validateLink=m,this.normalizeLink=g,this.normalizeLinkText=k,this.utils=n,this.helpers=n.assign({},s),this.options={},this.configure(e),r&&this.set(r)}b.prototype.set=function(e){return n.assign(this.options,e),this},b.prototype.configure=function(e){var r,t=this;if(n.isString(e)&&!(e=h[r=e]))throw new Error('Wrong `markdown-it` preset "'+r+'", check name');if(!e)throw new Error("Wrong `markdown-it` preset, can't be empty");return e.options&&t.set(e.options),e.components&&Object.keys(e.components).forEach((function(r){e.components[r].rules&&t[r].ruler.enableOnly(e.components[r].rules),e.components[r].rules2&&t[r].ruler2.enableOnly(e.components[r].rules2)})),this},b.prototype.enable=function(e,r){var t=[];Array.isArray(e)||(e=[e]),["core","block","inline"].forEach((function(r){t=t.concat(this[r].ruler.enable(e,!0))}),this),t=t.concat(this.inline.ruler2.enable(e,!0));var n=e.filter((function(e){return t.indexOf(e)<0}));if(n.length&&!r)throw new Error("MarkdownIt. Failed to enable unknown rule(s): "+n);return this},b.prototype.disable=function(e,r){var t=[];Array.isArray(e)||(e=[e]),["core","block","inline"].forEach((function(r){t=t.concat(this[r].ruler.disable(e,!0))}),this),t=t.concat(this.inline.ruler2.disable(e,!0));var n=e.filter((function(e){return t.indexOf(e)<0}));if(n.length&&!r)throw new Error("MarkdownIt. Failed to disable unknown rule(s): "+n);return this},b.prototype.use=function(e){var r=[this].concat(Array.prototype.slice.call(arguments,1));return e.apply(e,r),this},b.prototype.parse=function(e,r){if("string"!=typeof e)throw new Error("Input data should be a String");var t=new this.core.State(e,this,r);return this.core.process(t),t.tokens},b.prototype.render=function(e,r){return r=r||{},this.renderer.render(this.parse(e,r),this.options,r)},b.prototype.parseInline=function(e,r){var t=new this.core.State(e,this,r);return t.inlineMode=!0,this.core.process(t),t.tokens},b.prototype.renderInline=function(e,r){return r=r||{},this.renderer.render(this.parseInline(e,r),this.options,r)},r.exports=b},{"./common/utils":4,"./helpers":5,"./parser_block":10,"./parser_core":11,"./parser_inline":12,"./presets/commonmark":13,"./presets/default":14,"./presets/zero":15,"./renderer":16,"linkify-it":53,mdurl:58,punycode:60}],10:[function(e,r,t){"use strict";var n=e("./ruler"),s=[["table",e("./rules_block/table"),["paragraph","reference"]],["code",e("./rules_block/code")],["fence",e("./rules_block/fence"),["paragraph","reference","blockquote","list"]],["blockquote",e("./rules_block/blockquote"),["paragraph","reference","blockquote","list"]],["hr",e("./rules_block/hr"),["paragraph","reference","blockquote","list"]],["list",e("./rules_block/list"),["paragraph","reference","blockquote"]],["reference",e("./rules_block/reference")],["heading",e("./rules_block/heading"),["paragraph","reference","blockquote"]],["lheading",e("./rules_block/lheading")],["html_block",e("./rules_block/html_block"),["paragraph","reference","blockquote"]],["paragraph",e("./rules_block/paragraph")]];function o(){this.ruler=new n;for(var e=0;e<s.length;e++)this.ruler.push(s[e][0],s[e][1],{alt:(s[e][2]||[]).slice()})}o.prototype.tokenize=function(e,r,t){for(var n,s=this.ruler.getRules(""),o=s.length,i=r,a=!1,c=e.md.options.maxNesting;i<t&&(e.line=i=e.skipEmptyLines(i),!(i>=t))&&!(e.sCount[i]<e.blkIndent);){if(e.level>=c){e.line=t;break}for(n=0;n<o&&!s[n](e,i,t,!1);n++);e.tight=!a,e.isEmpty(e.line-1)&&(a=!0),(i=e.line)<t&&e.isEmpty(i)&&(a=!0,i++,e.line=i)}},o.prototype.parse=function(e,r,t,n){var s;e&&(s=new this.State(e,r,t,n),this.tokenize(s,s.line,s.lineMax))},o.prototype.State=e("./rules_block/state_block"),r.exports=o},{"./ruler":17,"./rules_block/blockquote":18,"./rules_block/code":19,"./rules_block/fence":20,"./rules_block/heading":21,"./rules_block/hr":22,"./rules_block/html_block":23,"./rules_block/lheading":24,"./rules_block/list":25,"./rules_block/paragraph":26,"./rules_block/reference":27,"./rules_block/state_block":28,"./rules_block/table":29}],11:[function(e,r,t){"use strict";var n=e("./ruler"),s=[["normalize",e("./rules_core/normalize")],["block",e("./rules_core/block")],["inline",e("./rules_core/inline")],["linkify",e("./rules_core/linkify")],["replacements",e("./rules_core/replacements")],["smartquotes",e("./rules_core/smartquotes")]];function o(){this.ruler=new n;for(var e=0;e<s.length;e++)this.ruler.push(s[e][0],s[e][1])}o.prototype.process=function(e){var r,t,n;for(r=0,t=(n=this.ruler.getRules("")).length;r<t;r++)n[r](e)},o.prototype.State=e("./rules_core/state_core"),r.exports=o},{"./ruler":17,"./rules_core/block":30,"./rules_core/inline":31,"./rules_core/linkify":32,"./rules_core/normalize":33,"./rules_core/replacements":34,"./rules_core/smartquotes":35,"./rules_core/state_core":36}],12:[function(e,r,t){"use strict";var n=e("./ruler"),s=[["text",e("./rules_inline/text")],["newline",e("./rules_inline/newline")],["escape",e("./rules_inline/escape")],["backticks",e("./rules_inline/backticks")],["strikethrough",e("./rules_inline/strikethrough").tokenize],["emphasis",e("./rules_inline/emphasis").tokenize],["link",e("./rules_inline/link")],["image",e("./rules_inline/image")],["autolink",e("./rules_inline/autolink")],["html_inline",e("./rules_inline/html_inline")],["entity",e("./rules_inline/entity")]],o=[["balance_pairs",e("./rules_inline/balance_pairs")],["strikethrough",e("./rules_inline/strikethrough").postProcess],["emphasis",e("./rules_inline/emphasis").postProcess],["text_collapse",e("./rules_inline/text_collapse")]];function i(){var e;for(this.ruler=new n,e=0;e<s.length;e++)this.ruler.push(s[e][0],s[e][1]);for(this.ruler2=new n,e=0;e<o.length;e++)this.ruler2.push(o[e][0],o[e][1])}i.prototype.skipToken=function(e){var r,t,n=e.pos,s=this.ruler.getRules(""),o=s.length,i=e.md.options.maxNesting,a=e.cache;if(void 0===a[n]){if(e.level<i)for(t=0;t<o&&(e.level++,r=s[t](e,!0),e.level--,!r);t++);else e.pos=e.posMax;r||e.pos++,a[n]=e.pos}else e.pos=a[n]},i.prototype.tokenize=function(e){for(var r,t,n=this.ruler.getRules(""),s=n.length,o=e.posMax,i=e.md.options.maxNesting;e.pos<o;){if(e.level<i)for(t=0;t<s&&!(r=n[t](e,!1));t++);if(r){if(e.pos>=o)break}else e.pending+=e.src[e.pos++]}e.pending&&e.pushPending()},i.prototype.parse=function(e,r,t,n){var s,o,i,a=new this.State(e,r,t,n);for(this.tokenize(a),i=(o=this.ruler2.getRules("")).length,s=0;s<i;s++)o[s](a)},i.prototype.State=e("./rules_inline/state_inline"),r.exports=i},{"./ruler":17,"./rules_inline/autolink":37,"./rules_inline/backticks":38,"./rules_inline/balance_pairs":39,"./rules_inline/emphasis":40,"./rules_inline/entity":41,"./rules_inline/escape":42,"./rules_inline/html_inline":43,"./rules_inline/image":44,"./rules_inline/link":45,"./rules_inline/newline":46,"./rules_inline/state_inline":47,"./rules_inline/strikethrough":48,"./rules_inline/text":49,"./rules_inline/text_collapse":50}],13:[function(e,r,t){"use strict";r.exports={options:{html:!0,xhtmlOut:!0,breaks:!1,langPrefix:"language-",linkify:!1,typographer:!1,quotes:"\u201c\u201d\u2018\u2019",highlight:null,maxNesting:20},components:{core:{rules:["normalize","block","inline"]},block:{rules:["blockquote","code","fence","heading","hr","html_block","lheading","list","reference","paragraph"]},inline:{rules:["autolink","backticks","emphasis","entity","escape","html_inline","image","link","newline","text"],rules2:["balance_pairs","emphasis","text_collapse"]}}}},{}],14:[function(e,r,t){"use strict";r.exports={options:{html:!1,xhtmlOut:!1,breaks:!1,langPrefix:"language-",linkify:!1,typographer:!1,quotes:"\u201c\u201d\u2018\u2019",highlight:null,maxNesting:100},components:{core:{},block:{},inline:{}}}},{}],15:[function(e,r,t){"use strict";r.exports={options:{html:!1,xhtmlOut:!1,breaks:!1,langPrefix:"language-",linkify:!1,typographer:!1,quotes:"\u201c\u201d\u2018\u2019",highlight:null,maxNesting:20},components:{core:{rules:["normalize","block","inline"]},block:{rules:["paragraph"]},inline:{rules:["text"],rules2:["balance_pairs","text_collapse"]}}}},{}],16:[function(e,r,t){"use strict";var n=e("./common/utils").assign,s=e("./common/utils").unescapeAll,o=e("./common/utils").escapeHtml,i={};function a(){this.rules=n({},i)}i.code_inline=function(e,r,t,n,s){var i=e[r];return"<code"+s.renderAttrs(i)+">"+o(e[r].content)+"</code>"},i.code_block=function(e,r,t,n,s){var i=e[r];return"<pre"+s.renderAttrs(i)+"><code>"+o(e[r].content)+"</code></pre>\n"},i.fence=function(e,r,t,n,i){var a,c,l,u,p=e[r],h=p.info?s(p.info).trim():"",f="";return h&&(f=h.split(/\s+/g)[0]),0===(a=t.highlight&&t.highlight(p.content,f)||o(p.content)).indexOf("<pre")?a+"\n":h?(c=p.attrIndex("class"),l=p.attrs?p.attrs.slice():[],c<0?l.push(["class",t.langPrefix+f]):l[c][1]+=" "+t.langPrefix+f,u={attrs:l},"<pre><code"+i.renderAttrs(u)+">"+a+"</code></pre>\n"):"<pre><code"+i.renderAttrs(p)+">"+a+"</code></pre>\n"},i.image=function(e,r,t,n,s){var o=e[r];return o.attrs[o.attrIndex("alt")][1]=s.renderInlineAsText(o.children,t,n),s.renderToken(e,r,t)},i.hardbreak=function(e,r,t){return t.xhtmlOut?"<br />\n":"<br>\n"},i.softbreak=function(e,r,t){return t.breaks?t.xhtmlOut?"<br />\n":"<br>\n":"\n"},i.text=function(e,r){return o(e[r].content)},i.html_block=function(e,r){return e[r].content},i.html_inline=function(e,r){return e[r].content},a.prototype.renderAttrs=function(e){var r,t,n;if(!e.attrs)return"";for(n="",r=0,t=e.attrs.length;r<t;r++)n+=" "+o(e.attrs[r][0])+'="'+o(e.attrs[r][1])+'"';return n},a.prototype.renderToken=function(e,r,t){var n,s="",o=!1,i=e[r];return i.hidden?"":(i.block&&-1!==i.nesting&&r&&e[r-1].hidden&&(s+="\n"),s+=(-1===i.nesting?"</":"<")+i.tag,s+=this.renderAttrs(i),0===i.nesting&&t.xhtmlOut&&(s+=" /"),i.block&&(o=!0,1===i.nesting&&r+1<e.length&&("inline"===(n=e[r+1]).type||n.hidden?o=!1:-1===n.nesting&&n.tag===i.tag&&(o=!1))),s+=o?">\n":">")},a.prototype.renderInline=function(e,r,t){for(var n,s="",o=this.rules,i=0,a=e.length;i<a;i++)void 0!==o[n=e[i].type]?s+=o[n](e,i,r,t,this):s+=this.renderToken(e,i,r);return s},a.prototype.renderInlineAsText=function(e,r,t){for(var n="",s=0,o=e.length;s<o;s++)"text"===e[s].type?n+=e[s].content:"image"===e[s].type&&(n+=this.renderInlineAsText(e[s].children,r,t));return n},a.prototype.render=function(e,r,t){var n,s,o,i="",a=this.rules;for(n=0,s=e.length;n<s;n++)"inline"===(o=e[n].type)?i+=this.renderInline(e[n].children,r,t):void 0!==a[o]?i+=a[e[n].type](e,n,r,t,this):i+=this.renderToken(e,n,r,t);return i},r.exports=a},{"./common/utils":4}],17:[function(e,r,t){"use strict";function n(){this.__rules__=[],this.__cache__=null}n.prototype.__find__=function(e){for(var r=0;r<this.__rules__.length;r++)if(this.__rules__[r].name===e)return r;return-1},n.prototype.__compile__=function(){var e=this,r=[""];e.__rules__.forEach((function(e){e.enabled&&e.alt.forEach((function(e){r.indexOf(e)<0&&r.push(e)}))})),e.__cache__={},r.forEach((function(r){e.__cache__[r]=[],e.__rules__.forEach((function(t){t.enabled&&(r&&t.alt.indexOf(r)<0||e.__cache__[r].push(t.fn))}))}))},n.prototype.at=function(e,r,t){var n=this.__find__(e),s=t||{};if(-1===n)throw new Error("Parser rule not found: "+e);this.__rules__[n].fn=r,this.__rules__[n].alt=s.alt||[],this.__cache__=null},n.prototype.before=function(e,r,t,n){var s=this.__find__(e),o=n||{};if(-1===s)throw new Error("Parser rule not found: "+e);this.__rules__.splice(s,0,{name:r,enabled:!0,fn:t,alt:o.alt||[]}),this.__cache__=null},n.prototype.after=function(e,r,t,n){var s=this.__find__(e),o=n||{};if(-1===s)throw new Error("Parser rule not found: "+e);this.__rules__.splice(s+1,0,{name:r,enabled:!0,fn:t,alt:o.alt||[]}),this.__cache__=null},n.prototype.push=function(e,r,t){var n=t||{};this.__rules__.push({name:e,enabled:!0,fn:r,alt:n.alt||[]}),this.__cache__=null},n.prototype.enable=function(e,r){Array.isArray(e)||(e=[e]);var t=[];return e.forEach((function(e){var n=this.__find__(e);if(n<0){if(r)return;throw new Error("Rules manager: invalid rule name "+e)}this.__rules__[n].enabled=!0,t.push(e)}),this),this.__cache__=null,t},n.prototype.enableOnly=function(e,r){Array.isArray(e)||(e=[e]),this.__rules__.forEach((function(e){e.enabled=!1})),this.enable(e,r)},n.prototype.disable=function(e,r){Array.isArray(e)||(e=[e]);var t=[];return e.forEach((function(e){var n=this.__find__(e);if(n<0){if(r)return;throw new Error("Rules manager: invalid rule name "+e)}this.__rules__[n].enabled=!1,t.push(e)}),this),this.__cache__=null,t},n.prototype.getRules=function(e){return null===this.__cache__&&this.__compile__(),this.__cache__[e]||[]},r.exports=n},{}],18:[function(e,r,t){"use strict";var n=e("../common/utils").isSpace;r.exports=function(e,r,t,s){var o,i,a,c,l,u,p,h,f,d,m,_,g,k,b,v,y,C,x,A,w=e.lineMax,D=e.bMarks[r]+e.tShift[r],E=e.eMarks[r];if(e.sCount[r]-e.blkIndent>=4)return!1;if(62!==e.src.charCodeAt(D++))return!1;if(s)return!0;for(c=f=e.sCount[r]+D-(e.bMarks[r]+e.tShift[r]),32===e.src.charCodeAt(D)?(D++,c++,f++,o=!1,v=!0):9===e.src.charCodeAt(D)?(v=!0,(e.bsCount[r]+f)%4==3?(D++,c++,f++,o=!1):o=!0):v=!1,d=[e.bMarks[r]],e.bMarks[r]=D;D<E&&(i=e.src.charCodeAt(D),n(i));)9===i?f+=4-(f+e.bsCount[r]+(o?1:0))%4:f++,D++;for(m=[e.bsCount[r]],e.bsCount[r]=e.sCount[r]+1+(v?1:0),u=D>=E,k=[e.sCount[r]],e.sCount[r]=f-c,b=[e.tShift[r]],e.tShift[r]=D-e.bMarks[r],C=e.md.block.ruler.getRules("blockquote"),g=e.parentType,e.parentType="blockquote",A=!1,h=r+1;h<t&&(e.sCount[h]<e.blkIndent&&(A=!0),!((D=e.bMarks[h]+e.tShift[h])>=(E=e.eMarks[h])));h++)if(62!==e.src.charCodeAt(D++)||A){if(u)break;for(y=!1,a=0,l=C.length;a<l;a++)if(C[a](e,h,t,!0)){y=!0;break}if(y){e.lineMax=h,0!==e.blkIndent&&(d.push(e.bMarks[h]),m.push(e.bsCount[h]),b.push(e.tShift[h]),k.push(e.sCount[h]),e.sCount[h]-=e.blkIndent);break}d.push(e.bMarks[h]),m.push(e.bsCount[h]),b.push(e.tShift[h]),k.push(e.sCount[h]),e.sCount[h]=-1}else{for(c=f=e.sCount[h]+D-(e.bMarks[h]+e.tShift[h]),32===e.src.charCodeAt(D)?(D++,c++,f++,o=!1,v=!0):9===e.src.charCodeAt(D)?(v=!0,(e.bsCount[h]+f)%4==3?(D++,c++,f++,o=!1):o=!0):v=!1,d.push(e.bMarks[h]),e.bMarks[h]=D;D<E&&(i=e.src.charCodeAt(D),n(i));)9===i?f+=4-(f+e.bsCount[h]+(o?1:0))%4:f++,D++;u=D>=E,m.push(e.bsCount[h]),e.bsCount[h]=e.sCount[h]+1+(v?1:0),k.push(e.sCount[h]),e.sCount[h]=f-c,b.push(e.tShift[h]),e.tShift[h]=D-e.bMarks[h]}for(_=e.blkIndent,e.blkIndent=0,(x=e.push("blockquote_open","blockquote",1)).markup=">",x.map=p=[r,0],e.md.block.tokenize(e,r,h),(x=e.push("blockquote_close","blockquote",-1)).markup=">",e.lineMax=w,e.parentType=g,p[1]=e.line,a=0;a<b.length;a++)e.bMarks[a+r]=d[a],e.tShift[a+r]=b[a],e.sCount[a+r]=k[a],e.bsCount[a+r]=m[a];return e.blkIndent=_,!0}},{"../common/utils":4}],19:[function(e,r,t){"use strict";r.exports=function(e,r,t){var n,s,o;if(e.sCount[r]-e.blkIndent<4)return!1;for(s=n=r+1;n<t;)if(e.isEmpty(n))n++;else{if(!(e.sCount[n]-e.blkIndent>=4))break;s=++n}return e.line=s,(o=e.push("code_block","code",0)).content=e.getLines(r,s,4+e.blkIndent,!0),o.map=[r,e.line],!0}},{}],20:[function(e,r,t){"use strict";r.exports=function(e,r,t,n){var s,o,i,a,c,l,u,p=!1,h=e.bMarks[r]+e.tShift[r],f=e.eMarks[r];if(e.sCount[r]-e.blkIndent>=4)return!1;if(h+3>f)return!1;if(126!==(s=e.src.charCodeAt(h))&&96!==s)return!1;if(c=h,(o=(h=e.skipChars(h,s))-c)<3)return!1;if(u=e.src.slice(c,h),i=e.src.slice(h,f),96===s&&i.indexOf(String.fromCharCode(s))>=0)return!1;if(n)return!0;for(a=r;!(++a>=t)&&!((h=c=e.bMarks[a]+e.tShift[a])<(f=e.eMarks[a])&&e.sCount[a]<e.blkIndent);)if(e.src.charCodeAt(h)===s&&!(e.sCount[a]-e.blkIndent>=4||(h=e.skipChars(h,s))-c<o||(h=e.skipSpaces(h))<f)){p=!0;break}return o=e.sCount[r],e.line=a+(p?1:0),(l=e.push("fence","code",0)).info=i,l.content=e.getLines(r+1,a,o,!0),l.markup=u,l.map=[r,e.line],!0}},{}],21:[function(e,r,t){"use strict";var n=e("../common/utils").isSpace;r.exports=function(e,r,t,s){var o,i,a,c,l=e.bMarks[r]+e.tShift[r],u=e.eMarks[r];if(e.sCount[r]-e.blkIndent>=4)return!1;if(35!==(o=e.src.charCodeAt(l))||l>=u)return!1;for(i=1,o=e.src.charCodeAt(++l);35===o&&l<u&&i<=6;)i++,o=e.src.charCodeAt(++l);return!(i>6||l<u&&!n(o))&&(!!s||(u=e.skipSpacesBack(u,l),(a=e.skipCharsBack(u,35,l))>l&&n(e.src.charCodeAt(a-1))&&(u=a),e.line=r+1,(c=e.push("heading_open","h"+String(i),1)).markup="########".slice(0,i),c.map=[r,e.line],(c=e.push("inline","",0)).content=e.src.slice(l,u).trim(),c.map=[r,e.line],c.children=[],(c=e.push("heading_close","h"+String(i),-1)).markup="########".slice(0,i),!0))}},{"../common/utils":4}],22:[function(e,r,t){"use strict";var n=e("../common/utils").isSpace;r.exports=function(e,r,t,s){var o,i,a,c,l=e.bMarks[r]+e.tShift[r],u=e.eMarks[r];if(e.sCount[r]-e.blkIndent>=4)return!1;if(42!==(o=e.src.charCodeAt(l++))&&45!==o&&95!==o)return!1;for(i=1;l<u;){if((a=e.src.charCodeAt(l++))!==o&&!n(a))return!1;a===o&&i++}return!(i<3)&&(!!s||(e.line=r+1,(c=e.push("hr","hr",0)).map=[r,e.line],c.markup=Array(i+1).join(String.fromCharCode(o)),!0))}},{"../common/utils":4}],23:[function(e,r,t){"use strict";var n=e("../common/html_blocks"),s=e("../common/html_re").HTML_OPEN_CLOSE_TAG_RE,o=[[/^<(script|pre|style)(?=(\s|>|$))/i,/<\/(script|pre|style)>/i,!0],[/^<!--/,/-->/,!0],[/^<\?/,/\?>/,!0],[/^<![A-Z]/,/>/,!0],[/^<!\[CDATA\[/,/\]\]>/,!0],[new RegExp("^</?("+n.join("|")+")(?=(\\s|/?>|$))","i"),/^$/,!0],[new RegExp(s.source+"\\s*$"),/^$/,!1]];r.exports=function(e,r,t,n){var s,i,a,c,l=e.bMarks[r]+e.tShift[r],u=e.eMarks[r];if(e.sCount[r]-e.blkIndent>=4)return!1;if(!e.md.options.html)return!1;if(60!==e.src.charCodeAt(l))return!1;for(c=e.src.slice(l,u),s=0;s<o.length&&!o[s][0].test(c);s++);if(s===o.length)return!1;if(n)return o[s][2];if(i=r+1,!o[s][1].test(c))for(;i<t&&!(e.sCount[i]<e.blkIndent);i++)if(l=e.bMarks[i]+e.tShift[i],u=e.eMarks[i],c=e.src.slice(l,u),o[s][1].test(c)){0!==c.length&&i++;break}return e.line=i,(a=e.push("html_block","",0)).map=[r,i],a.content=e.getLines(r,i,e.blkIndent,!0),!0}},{"../common/html_blocks":2,"../common/html_re":3}],24:[function(e,r,t){"use strict";r.exports=function(e,r,t){var n,s,o,i,a,c,l,u,p,h,f=r+1,d=e.md.block.ruler.getRules("paragraph");if(e.sCount[r]-e.blkIndent>=4)return!1;for(h=e.parentType,e.parentType="paragraph";f<t&&!e.isEmpty(f);f++)if(!(e.sCount[f]-e.blkIndent>3)){if(e.sCount[f]>=e.blkIndent&&(c=e.bMarks[f]+e.tShift[f])<(l=e.eMarks[f])&&(45===(p=e.src.charCodeAt(c))||61===p)&&(c=e.skipChars(c,p),(c=e.skipSpaces(c))>=l)){u=61===p?1:2;break}if(!(e.sCount[f]<0)){for(s=!1,o=0,i=d.length;o<i;o++)if(d[o](e,f,t,!0)){s=!0;break}if(s)break}}return!!u&&(n=e.getLines(r,f,e.blkIndent,!1).trim(),e.line=f+1,(a=e.push("heading_open","h"+String(u),1)).markup=String.fromCharCode(p),a.map=[r,e.line],(a=e.push("inline","",0)).content=n,a.map=[r,e.line-1],a.children=[],(a=e.push("heading_close","h"+String(u),-1)).markup=String.fromCharCode(p),e.parentType=h,!0)}},{}],25:[function(e,r,t){"use strict";var n=e("../common/utils").isSpace;function s(e,r){var t,s,o,i;return s=e.bMarks[r]+e.tShift[r],o=e.eMarks[r],42!==(t=e.src.charCodeAt(s++))&&45!==t&&43!==t?-1:s<o&&(i=e.src.charCodeAt(s),!n(i))?-1:s}function o(e,r){var t,s=e.bMarks[r]+e.tShift[r],o=s,i=e.eMarks[r];if(o+1>=i)return-1;if((t=e.src.charCodeAt(o++))<48||t>57)return-1;for(;;){if(o>=i)return-1;if(!((t=e.src.charCodeAt(o++))>=48&&t<=57)){if(41===t||46===t)break;return-1}if(o-s>=10)return-1}return o<i&&(t=e.src.charCodeAt(o),!n(t))?-1:o}r.exports=function(e,r,t,n){var i,a,c,l,u,p,h,f,d,m,_,g,k,b,v,y,C,x,A,w,D,E,q,F,S,L,z,T,I=!1,R=!0;if(e.sCount[r]-e.blkIndent>=4)return!1;if(e.listIndent>=0&&e.sCount[r]-e.listIndent>=4&&e.sCount[r]<e.blkIndent)return!1;if(n&&"paragraph"===e.parentType&&e.tShift[r]>=e.blkIndent&&(I=!0),(q=o(e,r))>=0){if(h=!0,S=e.bMarks[r]+e.tShift[r],k=Number(e.src.substr(S,q-S-1)),I&&1!==k)return!1}else{if(!((q=s(e,r))>=0))return!1;h=!1}if(I&&e.skipSpaces(q)>=e.eMarks[r])return!1;if(g=e.src.charCodeAt(q-1),n)return!0;for(_=e.tokens.length,h?(T=e.push("ordered_list_open","ol",1),1!==k&&(T.attrs=[["start",k]])):T=e.push("bullet_list_open","ul",1),T.map=m=[r,0],T.markup=String.fromCharCode(g),v=r,F=!1,z=e.md.block.ruler.getRules("list"),x=e.parentType,e.parentType="list";v<t;){for(E=q,b=e.eMarks[v],p=y=e.sCount[v]+q-(e.bMarks[r]+e.tShift[r]);E<b;){if(9===(i=e.src.charCodeAt(E)))y+=4-(y+e.bsCount[v])%4;else{if(32!==i)break;y++}E++}if((u=(a=E)>=b?1:y-p)>4&&(u=1),l=p+u,(T=e.push("list_item_open","li",1)).markup=String.fromCharCode(g),T.map=f=[r,0],D=e.tight,w=e.tShift[r],A=e.sCount[r],C=e.listIndent,e.listIndent=e.blkIndent,e.blkIndent=l,e.tight=!0,e.tShift[r]=a-e.bMarks[r],e.sCount[r]=y,a>=b&&e.isEmpty(r+1)?e.line=Math.min(e.line+2,t):e.md.block.tokenize(e,r,t,!0),e.tight&&!F||(R=!1),F=e.line-r>1&&e.isEmpty(e.line-1),e.blkIndent=e.listIndent,e.listIndent=C,e.tShift[r]=w,e.sCount[r]=A,e.tight=D,(T=e.push("list_item_close","li",-1)).markup=String.fromCharCode(g),v=r=e.line,f[1]=v,a=e.bMarks[r],v>=t)break;if(e.sCount[v]<e.blkIndent)break;if(e.sCount[r]-e.blkIndent>=4)break;for(L=!1,c=0,d=z.length;c<d;c++)if(z[c](e,v,t,!0)){L=!0;break}if(L)break;if(h){if((q=o(e,v))<0)break}else if((q=s(e,v))<0)break;if(g!==e.src.charCodeAt(q-1))break}return(T=h?e.push("ordered_list_close","ol",-1):e.push("bullet_list_close","ul",-1)).markup=String.fromCharCode(g),m[1]=v,e.line=v,e.parentType=x,R&&function(e,r){var t,n,s=e.level+2;for(t=r+2,n=e.tokens.length-2;t<n;t++)e.tokens[t].level===s&&"paragraph_open"===e.tokens[t].type&&(e.tokens[t+2].hidden=!0,e.tokens[t].hidden=!0,t+=2)}(e,_),!0}},{"../common/utils":4}],26:[function(e,r,t){"use strict";r.exports=function(e,r){var t,n,s,o,i,a,c=r+1,l=e.md.block.ruler.getRules("paragraph"),u=e.lineMax;for(a=e.parentType,e.parentType="paragraph";c<u&&!e.isEmpty(c);c++)if(!(e.sCount[c]-e.blkIndent>3||e.sCount[c]<0)){for(n=!1,s=0,o=l.length;s<o;s++)if(l[s](e,c,u,!0)){n=!0;break}if(n)break}return t=e.getLines(r,c,e.blkIndent,!1).trim(),e.line=c,(i=e.push("paragraph_open","p",1)).map=[r,e.line],(i=e.push("inline","",0)).content=t,i.map=[r,e.line],i.children=[],i=e.push("paragraph_close","p",-1),e.parentType=a,!0}},{}],27:[function(e,r,t){"use strict";var n=e("../common/utils").normalizeReference,s=e("../common/utils").isSpace;r.exports=function(e,r,t,o){var i,a,c,l,u,p,h,f,d,m,_,g,k,b,v,y,C=0,x=e.bMarks[r]+e.tShift[r],A=e.eMarks[r],w=r+1;if(e.sCount[r]-e.blkIndent>=4)return!1;if(91!==e.src.charCodeAt(x))return!1;for(;++x<A;)if(93===e.src.charCodeAt(x)&&92!==e.src.charCodeAt(x-1)){if(x+1===A)return!1;if(58!==e.src.charCodeAt(x+1))return!1;break}for(l=e.lineMax,v=e.md.block.ruler.getRules("reference"),m=e.parentType,e.parentType="reference";w<l&&!e.isEmpty(w);w++)if(!(e.sCount[w]-e.blkIndent>3||e.sCount[w]<0)){for(b=!1,p=0,h=v.length;p<h;p++)if(v[p](e,w,l,!0)){b=!0;break}if(b)break}for(A=(k=e.getLines(r,w,e.blkIndent,!1).trim()).length,x=1;x<A;x++){if(91===(i=k.charCodeAt(x)))return!1;if(93===i){d=x;break}10===i?C++:92===i&&++x<A&&10===k.charCodeAt(x)&&C++}if(d<0||58!==k.charCodeAt(d+1))return!1;for(x=d+2;x<A;x++)if(10===(i=k.charCodeAt(x)))C++;else if(!s(i))break;if(!(_=e.md.helpers.parseLinkDestination(k,x,A)).ok)return!1;if(u=e.md.normalizeLink(_.str),!e.md.validateLink(u))return!1;for(a=x=_.pos,c=C+=_.lines,g=x;x<A;x++)if(10===(i=k.charCodeAt(x)))C++;else if(!s(i))break;for(_=e.md.helpers.parseLinkTitle(k,x,A),x<A&&g!==x&&_.ok?(y=_.str,x=_.pos,C+=_.lines):(y="",x=a,C=c);x<A&&(i=k.charCodeAt(x),s(i));)x++;if(x<A&&10!==k.charCodeAt(x)&&y)for(y="",x=a,C=c;x<A&&(i=k.charCodeAt(x),s(i));)x++;return!(x<A&&10!==k.charCodeAt(x))&&(!!(f=n(k.slice(1,d)))&&(!!o||(void 0===e.env.references&&(e.env.references={}),void 0===e.env.references[f]&&(e.env.references[f]={title:y,href:u}),e.parentType=m,e.line=r+C+1,!0)))}},{"../common/utils":4}],28:[function(e,r,t){"use strict";var n=e("../token"),s=e("../common/utils").isSpace;function o(e,r,t,n){var o,i,a,c,l,u,p,h;for(this.src=e,this.md=r,this.env=t,this.tokens=n,this.bMarks=[],this.eMarks=[],this.tShift=[],this.sCount=[],this.bsCount=[],this.blkIndent=0,this.line=0,this.lineMax=0,this.tight=!1,this.ddIndent=-1,this.listIndent=-1,this.parentType="root",this.level=0,this.result="",h=!1,a=c=u=p=0,l=(i=this.src).length;c<l;c++){if(o=i.charCodeAt(c),!h){if(s(o)){u++,9===o?p+=4-p%4:p++;continue}h=!0}10!==o&&c!==l-1||(10!==o&&c++,this.bMarks.push(a),this.eMarks.push(c),this.tShift.push(u),this.sCount.push(p),this.bsCount.push(0),h=!1,u=0,p=0,a=c+1)}this.bMarks.push(i.length),this.eMarks.push(i.length),this.tShift.push(0),this.sCount.push(0),this.bsCount.push(0),this.lineMax=this.bMarks.length-1}o.prototype.push=function(e,r,t){var s=new n(e,r,t);return s.block=!0,t<0&&this.level--,s.level=this.level,t>0&&this.level++,this.tokens.push(s),s},o.prototype.isEmpty=function(e){return this.bMarks[e]+this.tShift[e]>=this.eMarks[e]},o.prototype.skipEmptyLines=function(e){for(var r=this.lineMax;e<r&&!(this.bMarks[e]+this.tShift[e]<this.eMarks[e]);e++);return e},o.prototype.skipSpaces=function(e){for(var r,t=this.src.length;e<t&&(r=this.src.charCodeAt(e),s(r));e++);return e},o.prototype.skipSpacesBack=function(e,r){if(e<=r)return e;for(;e>r;)if(!s(this.src.charCodeAt(--e)))return e+1;return e},o.prototype.skipChars=function(e,r){for(var t=this.src.length;e<t&&this.src.charCodeAt(e)===r;e++);return e},o.prototype.skipCharsBack=function(e,r,t){if(e<=t)return e;for(;e>t;)if(r!==this.src.charCodeAt(--e))return e+1;return e},o.prototype.getLines=function(e,r,t,n){var o,i,a,c,l,u,p,h=e;if(e>=r)return"";for(u=new Array(r-e),o=0;h<r;h++,o++){for(i=0,p=c=this.bMarks[h],l=h+1<r||n?this.eMarks[h]+1:this.eMarks[h];c<l&&i<t;){if(a=this.src.charCodeAt(c),s(a))9===a?i+=4-(i+this.bsCount[h])%4:i++;else{if(!(c-p<this.tShift[h]))break;i++}c++}u[o]=i>t?new Array(i-t+1).join(" ")+this.src.slice(c,l):this.src.slice(c,l)}return u.join("")},o.prototype.Token=n,r.exports=o},{"../common/utils":4,"../token":51}],29:[function(e,r,t){"use strict";var n=e("../common/utils").isSpace;function s(e,r){var t=e.bMarks[r]+e.blkIndent,n=e.eMarks[r];return e.src.substr(t,n-t)}function o(e){var r,t=[],n=0,s=e.length,o=0,i=0,a=!1,c=0;for(r=e.charCodeAt(n);n<s;)96===r?a?(a=!1,c=n):o%2==0&&(a=!0,c=n):124!==r||o%2!=0||a||(t.push(e.substring(i,n)),i=n+1),92===r?o++:o=0,++n===s&&a&&(a=!1,n=c+1),r=e.charCodeAt(n);return t.push(e.substring(i)),t}r.exports=function(e,r,t,i){var a,c,l,u,p,h,f,d,m,_,g,k;if(r+2>t)return!1;if(p=r+1,e.sCount[p]<e.blkIndent)return!1;if(e.sCount[p]-e.blkIndent>=4)return!1;if((l=e.bMarks[p]+e.tShift[p])>=e.eMarks[p])return!1;if(124!==(a=e.src.charCodeAt(l++))&&45!==a&&58!==a)return!1;for(;l<e.eMarks[p];){if(124!==(a=e.src.charCodeAt(l))&&45!==a&&58!==a&&!n(a))return!1;l++}for(h=(c=s(e,r+1)).split("|"),m=[],u=0;u<h.length;u++){if(!(_=h[u].trim())){if(0===u||u===h.length-1)continue;return!1}if(!/^:?-+:?$/.test(_))return!1;58===_.charCodeAt(_.length-1)?m.push(58===_.charCodeAt(0)?"center":"right"):58===_.charCodeAt(0)?m.push("left"):m.push("")}if(-1===(c=s(e,r).trim()).indexOf("|"))return!1;if(e.sCount[r]-e.blkIndent>=4)return!1;if((f=(h=o(c.replace(/^\||\|$/g,""))).length)>m.length)return!1;if(i)return!0;for((d=e.push("table_open","table",1)).map=g=[r,0],(d=e.push("thead_open","thead",1)).map=[r,r+1],(d=e.push("tr_open","tr",1)).map=[r,r+1],u=0;u<h.length;u++)(d=e.push("th_open","th",1)).map=[r,r+1],m[u]&&(d.attrs=[["style","text-align:"+m[u]]]),(d=e.push("inline","",0)).content=h[u].trim(),d.map=[r,r+1],d.children=[],d=e.push("th_close","th",-1);for(d=e.push("tr_close","tr",-1),d=e.push("thead_close","thead",-1),(d=e.push("tbody_open","tbody",1)).map=k=[r+2,0],p=r+2;p<t&&!(e.sCount[p]<e.blkIndent)&&-1!==(c=s(e,p).trim()).indexOf("|")&&!(e.sCount[p]-e.blkIndent>=4);p++){for(h=o(c.replace(/^\||\|$/g,"")),d=e.push("tr_open","tr",1),u=0;u<f;u++)d=e.push("td_open","td",1),m[u]&&(d.attrs=[["style","text-align:"+m[u]]]),(d=e.push("inline","",0)).content=h[u]?h[u].trim():"",d.children=[],d=e.push("td_close","td",-1);d=e.push("tr_close","tr",-1)}return d=e.push("tbody_close","tbody",-1),d=e.push("table_close","table",-1),g[1]=k[1]=p,e.line=p,!0}},{"../common/utils":4}],30:[function(e,r,t){"use strict";r.exports=function(e){var r;e.inlineMode?((r=new e.Token("inline","",0)).content=e.src,r.map=[0,1],r.children=[],e.tokens.push(r)):e.md.block.parse(e.src,e.md,e.env,e.tokens)}},{}],31:[function(e,r,t){"use strict";r.exports=function(e){var r,t,n,s=e.tokens;for(t=0,n=s.length;t<n;t++)"inline"===(r=s[t]).type&&e.md.inline.parse(r.content,e.md,e.env,r.children)}},{}],32:[function(e,r,t){"use strict";var n=e("../common/utils").arrayReplaceAt;function s(e){return/^<\/a\s*>/i.test(e)}r.exports=function(e){var r,t,o,i,a,c,l,u,p,h,f,d,m,_,g,k,b,v,y=e.tokens;if(e.md.options.linkify)for(t=0,o=y.length;t<o;t++)if("inline"===y[t].type&&e.md.linkify.pretest(y[t].content))for(m=0,r=(i=y[t].children).length-1;r>=0;r--)if("link_close"!==(c=i[r]).type){if("html_inline"===c.type&&(v=c.content,/^<a[>\s]/i.test(v)&&m>0&&m--,s(c.content)&&m++),!(m>0)&&"text"===c.type&&e.md.linkify.test(c.content)){for(p=c.content,b=e.md.linkify.match(p),l=[],d=c.level,f=0,u=0;u<b.length;u++)_=b[u].url,g=e.md.normalizeLink(_),e.md.validateLink(g)&&(k=b[u].text,k=b[u].schema?"mailto:"!==b[u].schema||/^mailto:/i.test(k)?e.md.normalizeLinkText(k):e.md.normalizeLinkText("mailto:"+k).replace(/^mailto:/,""):e.md.normalizeLinkText("http://"+k).replace(/^http:\/\//,""),(h=b[u].index)>f&&((a=new e.Token("text","",0)).content=p.slice(f,h),a.level=d,l.push(a)),(a=new e.Token("link_open","a",1)).attrs=[["href",g]],a.level=d++,a.markup="linkify",a.info="auto",l.push(a),(a=new e.Token("text","",0)).content=k,a.level=d,l.push(a),(a=new e.Token("link_close","a",-1)).level=--d,a.markup="linkify",a.info="auto",l.push(a),f=b[u].lastIndex);f<p.length&&((a=new e.Token("text","",0)).content=p.slice(f),a.level=d,l.push(a)),y[t].children=i=n(i,r,l)}}else for(r--;i[r].level!==c.level&&"link_open"!==i[r].type;)r--}},{"../common/utils":4}],33:[function(e,r,t){"use strict";var n=/\r\n?|\n/g,s=/\0/g;r.exports=function(e){var r;r=(r=e.src.replace(n,"\n")).replace(s,"\ufffd"),e.src=r}},{}],34:[function(e,r,t){"use strict";var n=/\+-|\.\.|\?\?\?\?|!!!!|,,|--/,s=/\((c|tm|r|p)\)/i,o=/\((c|tm|r|p)\)/gi,i={c:"\xa9",r:"\xae",p:"\xa7",tm:"\u2122"};function a(e,r){return i[r.toLowerCase()]}function c(e){var r,t,n=0;for(r=e.length-1;r>=0;r--)"text"!==(t=e[r]).type||n||(t.content=t.content.replace(o,a)),"link_open"===t.type&&"auto"===t.info&&n--,"link_close"===t.type&&"auto"===t.info&&n++}function l(e){var r,t,s=0;for(r=e.length-1;r>=0;r--)"text"!==(t=e[r]).type||s||n.test(t.content)&&(t.content=t.content.replace(/\+-/g,"\xb1").replace(/\.{2,}/g,"\u2026").replace(/([?!])\u2026/g,"$1..").replace(/([?!]){4,}/g,"$1$1$1").replace(/,{2,}/g,",").replace(/(^|[^-])---([^-]|$)/gm,"$1\u2014$2").replace(/(^|\s)--(\s|$)/gm,"$1\u2013$2").replace(/(^|[^-\s])--([^-\s]|$)/gm,"$1\u2013$2")),"link_open"===t.type&&"auto"===t.info&&s--,"link_close"===t.type&&"auto"===t.info&&s++}r.exports=function(e){var r;if(e.md.options.typographer)for(r=e.tokens.length-1;r>=0;r--)"inline"===e.tokens[r].type&&(s.test(e.tokens[r].content)&&c(e.tokens[r].children),n.test(e.tokens[r].content)&&l(e.tokens[r].children))}},{}],35:[function(e,r,t){"use strict";var n=e("../common/utils").isWhiteSpace,s=e("../common/utils").isPunctChar,o=e("../common/utils").isMdAsciiPunct,i=/['"]/,a=/['"]/g,c="\u2019";function l(e,r,t){return e.substr(0,r)+t+e.substr(r+1)}function u(e,r){var t,i,u,p,h,f,d,m,_,g,k,b,v,y,C,x,A,w,D,E,q;for(D=[],t=0;t<e.length;t++){for(i=e[t],d=e[t].level,A=D.length-1;A>=0&&!(D[A].level<=d);A--);if(D.length=A+1,"text"===i.type){h=0,f=(u=i.content).length;e:for(;h<f&&(a.lastIndex=h,p=a.exec(u));){if(C=x=!0,h=p.index+1,w="'"===p[0],_=32,p.index-1>=0)_=u.charCodeAt(p.index-1);else for(A=t-1;A>=0&&("softbreak"!==e[A].type&&"hardbreak"!==e[A].type);A--)if("text"===e[A].type){_=e[A].content.charCodeAt(e[A].content.length-1);break}if(g=32,h<f)g=u.charCodeAt(h);else for(A=t+1;A<e.length&&("softbreak"!==e[A].type&&"hardbreak"!==e[A].type);A++)if("text"===e[A].type){g=e[A].content.charCodeAt(0);break}if(k=o(_)||s(String.fromCharCode(_)),b=o(g)||s(String.fromCharCode(g)),v=n(_),(y=n(g))?C=!1:b&&(v||k||(C=!1)),v?x=!1:k&&(y||b||(x=!1)),34===g&&'"'===p[0]&&_>=48&&_<=57&&(x=C=!1),C&&x&&(C=!1,x=b),C||x){if(x)for(A=D.length-1;A>=0&&(m=D[A],!(D[A].level<d));A--)if(m.single===w&&D[A].level===d){m=D[A],w?(E=r.md.options.quotes[2],q=r.md.options.quotes[3]):(E=r.md.options.quotes[0],q=r.md.options.quotes[1]),i.content=l(i.content,p.index,q),e[m.token].content=l(e[m.token].content,m.pos,E),h+=q.length-1,m.token===t&&(h+=E.length-1),f=(u=i.content).length,D.length=A;continue e}C?D.push({token:t,pos:p.index,single:w,level:d}):x&&w&&(i.content=l(i.content,p.index,c))}else w&&(i.content=l(i.content,p.index,c))}}}}r.exports=function(e){var r;if(e.md.options.typographer)for(r=e.tokens.length-1;r>=0;r--)"inline"===e.tokens[r].type&&i.test(e.tokens[r].content)&&u(e.tokens[r].children,e)}},{"../common/utils":4}],36:[function(e,r,t){"use strict";var n=e("../token");function s(e,r,t){this.src=e,this.env=t,this.tokens=[],this.inlineMode=!1,this.md=r}s.prototype.Token=n,r.exports=s},{"../token":51}],37:[function(e,r,t){"use strict";var n=/^<([a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*)>/,s=/^<([a-zA-Z][a-zA-Z0-9+.\-]{1,31}):([^<>\x00-\x20]*)>/;r.exports=function(e,r){var t,o,i,a,c,l,u=e.pos;return 60===e.src.charCodeAt(u)&&(!((t=e.src.slice(u)).indexOf(">")<0)&&(s.test(t)?(a=(o=t.match(s))[0].slice(1,-1),c=e.md.normalizeLink(a),!!e.md.validateLink(c)&&(r||((l=e.push("link_open","a",1)).attrs=[["href",c]],l.markup="autolink",l.info="auto",(l=e.push("text","",0)).content=e.md.normalizeLinkText(a),(l=e.push("link_close","a",-1)).markup="autolink",l.info="auto"),e.pos+=o[0].length,!0)):!!n.test(t)&&(a=(i=t.match(n))[0].slice(1,-1),c=e.md.normalizeLink("mailto:"+a),!!e.md.validateLink(c)&&(r||((l=e.push("link_open","a",1)).attrs=[["href",c]],l.markup="autolink",l.info="auto",(l=e.push("text","",0)).content=e.md.normalizeLinkText(a),(l=e.push("link_close","a",-1)).markup="autolink",l.info="auto"),e.pos+=i[0].length,!0))))}},{}],38:[function(e,r,t){"use strict";r.exports=function(e,r){var t,n,s,o,i,a,c=e.pos;if(96!==e.src.charCodeAt(c))return!1;for(t=c,c++,n=e.posMax;c<n&&96===e.src.charCodeAt(c);)c++;for(s=e.src.slice(t,c),o=i=c;-1!==(o=e.src.indexOf("`",i));){for(i=o+1;i<n&&96===e.src.charCodeAt(i);)i++;if(i-o===s.length)return r||((a=e.push("code_inline","code",0)).markup=s,a.content=e.src.slice(c,o).replace(/\n/g," ").replace(/^ (.+) $/,"$1")),e.pos=i,!0}return r||(e.pending+=s),e.pos+=s.length,!0}},{}],39:[function(e,r,t){"use strict";function n(e,r){var t,n,s,o,i,a,c,l,u={},p=r.length;for(t=0;t<p;t++)if((s=r[t]).length=s.length||0,s.close){for(u.hasOwnProperty(s.marker)||(u[s.marker]=[-1,-1,-1]),i=u[s.marker][s.length%3],a=-1,n=t-s.jump-1;n>i;n-=o.jump+1)if((o=r[n]).marker===s.marker&&(-1===a&&(a=n),o.open&&o.end<0&&o.level===s.level&&(c=!1,(o.close||s.open)&&(o.length+s.length)%3==0&&(o.length%3==0&&s.length%3==0||(c=!0)),!c))){l=n>0&&!r[n-1].open?r[n-1].jump+1:0,s.jump=t-n+l,s.open=!1,o.end=t,o.jump=l,o.close=!1,a=-1;break}-1!==a&&(u[s.marker][(s.length||0)%3]=a)}}r.exports=function(e){var r,t=e.tokens_meta,s=e.tokens_meta.length;for(n(0,e.delimiters),r=0;r<s;r++)t[r]&&t[r].delimiters&&n(0,t[r].delimiters)}},{}],40:[function(e,r,t){"use strict";function n(e,r){var t,n,s,o,i,a;for(t=r.length-1;t>=0;t--)95!==(n=r[t]).marker&&42!==n.marker||-1!==n.end&&(s=r[n.end],a=t>0&&r[t-1].end===n.end+1&&r[t-1].token===n.token-1&&r[n.end+1].token===s.token+1&&r[t-1].marker===n.marker,i=String.fromCharCode(n.marker),(o=e.tokens[n.token]).type=a?"strong_open":"em_open",o.tag=a?"strong":"em",o.nesting=1,o.markup=a?i+i:i,o.content="",(o=e.tokens[s.token]).type=a?"strong_close":"em_close",o.tag=a?"strong":"em",o.nesting=-1,o.markup=a?i+i:i,o.content="",a&&(e.tokens[r[t-1].token].content="",e.tokens[r[n.end+1].token].content="",t--))}r.exports.tokenize=function(e,r){var t,n,s=e.pos,o=e.src.charCodeAt(s);if(r)return!1;if(95!==o&&42!==o)return!1;for(n=e.scanDelims(e.pos,42===o),t=0;t<n.length;t++)e.push("text","",0).content=String.fromCharCode(o),e.delimiters.push({marker:o,length:n.length,jump:t,token:e.tokens.length-1,end:-1,open:n.can_open,close:n.can_close});return e.pos+=n.length,!0},r.exports.postProcess=function(e){var r,t=e.tokens_meta,s=e.tokens_meta.length;for(n(e,e.delimiters),r=0;r<s;r++)t[r]&&t[r].delimiters&&n(e,t[r].delimiters)}},{}],41:[function(e,r,t){"use strict";var n=e("../common/entities"),s=e("../common/utils").has,o=e("../common/utils").isValidEntityCode,i=e("../common/utils").fromCodePoint,a=/^&#((?:x[a-f0-9]{1,6}|[0-9]{1,7}));/i,c=/^&([a-z][a-z0-9]{1,31});/i;r.exports=function(e,r){var t,l,u=e.pos,p=e.posMax;if(38!==e.src.charCodeAt(u))return!1;if(u+1<p)if(35===e.src.charCodeAt(u+1)){if(l=e.src.slice(u).match(a))return r||(t="x"===l[1][0].toLowerCase()?parseInt(l[1].slice(1),16):parseInt(l[1],10),e.pending+=o(t)?i(t):i(65533)),e.pos+=l[0].length,!0}else if((l=e.src.slice(u).match(c))&&s(n,l[1]))return r||(e.pending+=n[l[1]]),e.pos+=l[0].length,!0;return r||(e.pending+="&"),e.pos++,!0}},{"../common/entities":1,"../common/utils":4}],42:[function(e,r,t){"use strict";for(var n=e("../common/utils").isSpace,s=[],o=0;o<256;o++)s.push(0);"\\!\"#$%&'()*+,./:;<=>?@[]^_`{|}~-".split("").forEach((function(e){s[e.charCodeAt(0)]=1})),r.exports=function(e,r){var t,o=e.pos,i=e.posMax;if(92!==e.src.charCodeAt(o))return!1;if(++o<i){if((t=e.src.charCodeAt(o))<256&&0!==s[t])return r||(e.pending+=e.src[o]),e.pos+=2,!0;if(10===t){for(r||e.push("hardbreak","br",0),o++;o<i&&(t=e.src.charCodeAt(o),n(t));)o++;return e.pos=o,!0}}return r||(e.pending+="\\"),e.pos++,!0}},{"../common/utils":4}],43:[function(e,r,t){"use strict";var n=e("../common/html_re").HTML_TAG_RE;r.exports=function(e,r){var t,s,o,i=e.pos;return!!e.md.options.html&&(o=e.posMax,!(60!==e.src.charCodeAt(i)||i+2>=o)&&(!(33!==(t=e.src.charCodeAt(i+1))&&63!==t&&47!==t&&!function(e){var r=32|e;return r>=97&&r<=122}(t))&&(!!(s=e.src.slice(i).match(n))&&(r||(e.push("html_inline","",0).content=e.src.slice(i,i+s[0].length)),e.pos+=s[0].length,!0))))}},{"../common/html_re":3}],44:[function(e,r,t){"use strict";var n=e("../common/utils").normalizeReference,s=e("../common/utils").isSpace;r.exports=function(e,r){var t,o,i,a,c,l,u,p,h,f,d,m,_,g="",k=e.pos,b=e.posMax;if(33!==e.src.charCodeAt(e.pos))return!1;if(91!==e.src.charCodeAt(e.pos+1))return!1;if(l=e.pos+2,(c=e.md.helpers.parseLinkLabel(e,e.pos+1,!1))<0)return!1;if((u=c+1)<b&&40===e.src.charCodeAt(u)){for(u++;u<b&&(o=e.src.charCodeAt(u),s(o)||10===o);u++);if(u>=b)return!1;for(_=u,(h=e.md.helpers.parseLinkDestination(e.src,u,e.posMax)).ok&&(g=e.md.normalizeLink(h.str),e.md.validateLink(g)?u=h.pos:g=""),_=u;u<b&&(o=e.src.charCodeAt(u),s(o)||10===o);u++);if(h=e.md.helpers.parseLinkTitle(e.src,u,e.posMax),u<b&&_!==u&&h.ok)for(f=h.str,u=h.pos;u<b&&(o=e.src.charCodeAt(u),s(o)||10===o);u++);else f="";if(u>=b||41!==e.src.charCodeAt(u))return e.pos=k,!1;u++}else{if(void 0===e.env.references)return!1;if(u<b&&91===e.src.charCodeAt(u)?(_=u+1,(u=e.md.helpers.parseLinkLabel(e,u))>=0?a=e.src.slice(_,u++):u=c+1):u=c+1,a||(a=e.src.slice(l,c)),!(p=e.env.references[n(a)]))return e.pos=k,!1;g=p.href,f=p.title}return r||(i=e.src.slice(l,c),e.md.inline.parse(i,e.md,e.env,m=[]),(d=e.push("image","img",0)).attrs=t=[["src",g],["alt",""]],d.children=m,d.content=i,f&&t.push(["title",f])),e.pos=u,e.posMax=b,!0}},{"../common/utils":4}],45:[function(e,r,t){"use strict";var n=e("../common/utils").normalizeReference,s=e("../common/utils").isSpace;r.exports=function(e,r){var t,o,i,a,c,l,u,p,h,f="",d=e.pos,m=e.posMax,_=e.pos,g=!0;if(91!==e.src.charCodeAt(e.pos))return!1;if(c=e.pos+1,(a=e.md.helpers.parseLinkLabel(e,e.pos,!0))<0)return!1;if((l=a+1)<m&&40===e.src.charCodeAt(l)){for(g=!1,l++;l<m&&(o=e.src.charCodeAt(l),s(o)||10===o);l++);if(l>=m)return!1;for(_=l,(u=e.md.helpers.parseLinkDestination(e.src,l,e.posMax)).ok&&(f=e.md.normalizeLink(u.str),e.md.validateLink(f)?l=u.pos:f=""),_=l;l<m&&(o=e.src.charCodeAt(l),s(o)||10===o);l++);if(u=e.md.helpers.parseLinkTitle(e.src,l,e.posMax),l<m&&_!==l&&u.ok)for(h=u.str,l=u.pos;l<m&&(o=e.src.charCodeAt(l),s(o)||10===o);l++);else h="";(l>=m||41!==e.src.charCodeAt(l))&&(g=!0),l++}if(g){if(void 0===e.env.references)return!1;if(l<m&&91===e.src.charCodeAt(l)?(_=l+1,(l=e.md.helpers.parseLinkLabel(e,l))>=0?i=e.src.slice(_,l++):l=a+1):l=a+1,i||(i=e.src.slice(c,a)),!(p=e.env.references[n(i)]))return e.pos=d,!1;f=p.href,h=p.title}return r||(e.pos=c,e.posMax=a,e.push("link_open","a",1).attrs=t=[["href",f]],h&&t.push(["title",h]),e.md.inline.tokenize(e),e.push("link_close","a",-1)),e.pos=l,e.posMax=m,!0}},{"../common/utils":4}],46:[function(e,r,t){"use strict";var n=e("../common/utils").isSpace;r.exports=function(e,r){var t,s,o=e.pos;if(10!==e.src.charCodeAt(o))return!1;for(t=e.pending.length-1,s=e.posMax,r||(t>=0&&32===e.pending.charCodeAt(t)?t>=1&&32===e.pending.charCodeAt(t-1)?(e.pending=e.pending.replace(/ +$/,""),e.push("hardbreak","br",0)):(e.pending=e.pending.slice(0,-1),e.push("softbreak","br",0)):e.push("softbreak","br",0)),o++;o<s&&n(e.src.charCodeAt(o));)o++;return e.pos=o,!0}},{"../common/utils":4}],47:[function(e,r,t){"use strict";var n=e("../token"),s=e("../common/utils").isWhiteSpace,o=e("../common/utils").isPunctChar,i=e("../common/utils").isMdAsciiPunct;function a(e,r,t,n){this.src=e,this.env=t,this.md=r,this.tokens=n,this.tokens_meta=Array(n.length),this.pos=0,this.posMax=this.src.length,this.level=0,this.pending="",this.pendingLevel=0,this.cache={},this.delimiters=[],this._prev_delimiters=[]}a.prototype.pushPending=function(){var e=new n("text","",0);return e.content=this.pending,e.level=this.pendingLevel,this.tokens.push(e),this.pending="",e},a.prototype.push=function(e,r,t){this.pending&&this.pushPending();var s=new n(e,r,t),o=null;return t<0&&(this.level--,this.delimiters=this._prev_delimiters.pop()),s.level=this.level,t>0&&(this.level++,this._prev_delimiters.push(this.delimiters),this.delimiters=[],o={delimiters:this.delimiters}),this.pendingLevel=this.level,this.tokens.push(s),this.tokens_meta.push(o),s},a.prototype.scanDelims=function(e,r){var t,n,a,c,l,u,p,h,f,d=e,m=!0,_=!0,g=this.posMax,k=this.src.charCodeAt(e);for(t=e>0?this.src.charCodeAt(e-1):32;d<g&&this.src.charCodeAt(d)===k;)d++;return a=d-e,n=d<g?this.src.charCodeAt(d):32,p=i(t)||o(String.fromCharCode(t)),f=i(n)||o(String.fromCharCode(n)),u=s(t),(h=s(n))?m=!1:f&&(u||p||(m=!1)),u?_=!1:p&&(h||f||(_=!1)),r?(c=m,l=_):(c=m&&(!_||p),l=_&&(!m||f)),{can_open:c,can_close:l,length:a}},a.prototype.Token=n,r.exports=a},{"../common/utils":4,"../token":51}],48:[function(e,r,t){"use strict";function n(e,r){var t,n,s,o,i,a=[],c=r.length;for(t=0;t<c;t++)126===(s=r[t]).marker&&-1!==s.end&&(o=r[s.end],(i=e.tokens[s.token]).type="s_open",i.tag="s",i.nesting=1,i.markup="~~",i.content="",(i=e.tokens[o.token]).type="s_close",i.tag="s",i.nesting=-1,i.markup="~~",i.content="","text"===e.tokens[o.token-1].type&&"~"===e.tokens[o.token-1].content&&a.push(o.token-1));for(;a.length;){for(n=(t=a.pop())+1;n<e.tokens.length&&"s_close"===e.tokens[n].type;)n++;t!==--n&&(i=e.tokens[n],e.tokens[n]=e.tokens[t],e.tokens[t]=i)}}r.exports.tokenize=function(e,r){var t,n,s,o,i=e.pos,a=e.src.charCodeAt(i);if(r)return!1;if(126!==a)return!1;if(s=(n=e.scanDelims(e.pos,!0)).length,o=String.fromCharCode(a),s<2)return!1;for(s%2&&(e.push("text","",0).content=o,s--),t=0;t<s;t+=2)e.push("text","",0).content=o+o,e.delimiters.push({marker:a,length:0,jump:t,token:e.tokens.length-1,end:-1,open:n.can_open,close:n.can_close});return e.pos+=n.length,!0},r.exports.postProcess=function(e){var r,t=e.tokens_meta,s=e.tokens_meta.length;for(n(e,e.delimiters),r=0;r<s;r++)t[r]&&t[r].delimiters&&n(e,t[r].delimiters)}},{}],49:[function(e,r,t){"use strict";function n(e){switch(e){case 10:case 33:case 35:case 36:case 37:case 38:case 42:case 43:case 45:case 58:case 60:case 61:case 62:case 64:case 91:case 92:case 93:case 94:case 95:case 96:case 123:case 125:case 126:return!0;default:return!1}}r.exports=function(e,r){for(var t=e.pos;t<e.posMax&&!n(e.src.charCodeAt(t));)t++;return t!==e.pos&&(r||(e.pending+=e.src.slice(e.pos,t)),e.pos=t,!0)}},{}],50:[function(e,r,t){"use strict";r.exports=function(e){var r,t,n=0,s=e.tokens,o=e.tokens.length;for(r=t=0;r<o;r++)s[r].nesting<0&&n--,s[r].level=n,s[r].nesting>0&&n++,"text"===s[r].type&&r+1<o&&"text"===s[r+1].type?s[r+1].content=s[r].content+s[r+1].content:(r!==t&&(s[t]=s[r]),t++);r!==t&&(s.length=t)}},{}],51:[function(e,r,t){"use strict";function n(e,r,t){this.type=e,this.tag=r,this.attrs=null,this.map=null,this.nesting=t,this.level=0,this.children=null,this.content="",this.markup="",this.info="",this.meta=null,this.block=!1,this.hidden=!1}n.prototype.attrIndex=function(e){var r,t,n;if(!this.attrs)return-1;for(t=0,n=(r=this.attrs).length;t<n;t++)if(r[t][0]===e)return t;return-1},n.prototype.attrPush=function(e){this.attrs?this.attrs.push(e):this.attrs=[e]},n.prototype.attrSet=function(e,r){var t=this.attrIndex(e),n=[e,r];t<0?this.attrPush(n):this.attrs[t]=n},n.prototype.attrGet=function(e){var r=this.attrIndex(e),t=null;return r>=0&&(t=this.attrs[r][1]),t},n.prototype.attrJoin=function(e,r){var t=this.attrIndex(e);t<0?this.attrPush([e,r]):this.attrs[t][1]=this.attrs[t][1]+" "+r},r.exports=n},{}],52:[function(e,r,t){r.exports={Aacute:"\xc1",aacute:"\xe1",Abreve:"\u0102",abreve:"\u0103",ac:"\u223e",acd:"\u223f",acE:"\u223e\u0333",Acirc:"\xc2",acirc:"\xe2",acute:"\xb4",Acy:"\u0410",acy:"\u0430",AElig:"\xc6",aelig:"\xe6",af:"\u2061",Afr:"\ud835\udd04",afr:"\ud835\udd1e",Agrave:"\xc0",agrave:"\xe0",alefsym:"\u2135",aleph:"\u2135",Alpha:"\u0391",alpha:"\u03b1",Amacr:"\u0100",amacr:"\u0101",amalg:"\u2a3f",amp:"&",AMP:"&",andand:"\u2a55",And:"\u2a53",and:"\u2227",andd:"\u2a5c",andslope:"\u2a58",andv:"\u2a5a",ang:"\u2220",ange:"\u29a4",angle:"\u2220",angmsdaa:"\u29a8",angmsdab:"\u29a9",angmsdac:"\u29aa",angmsdad:"\u29ab",angmsdae:"\u29ac",angmsdaf:"\u29ad",angmsdag:"\u29ae",angmsdah:"\u29af",angmsd:"\u2221",angrt:"\u221f",angrtvb:"\u22be",angrtvbd:"\u299d",angsph:"\u2222",angst:"\xc5",angzarr:"\u237c",Aogon:"\u0104",aogon:"\u0105",Aopf:"\ud835\udd38",aopf:"\ud835\udd52",apacir:"\u2a6f",ap:"\u2248",apE:"\u2a70",ape:"\u224a",apid:"\u224b",apos:"'",ApplyFunction:"\u2061",approx:"\u2248",approxeq:"\u224a",Aring:"\xc5",aring:"\xe5",Ascr:"\ud835\udc9c",ascr:"\ud835\udcb6",Assign:"\u2254",ast:"*",asymp:"\u2248",asympeq:"\u224d",Atilde:"\xc3",atilde:"\xe3",Auml:"\xc4",auml:"\xe4",awconint:"\u2233",awint:"\u2a11",backcong:"\u224c",backepsilon:"\u03f6",backprime:"\u2035",backsim:"\u223d",backsimeq:"\u22cd",Backslash:"\u2216",Barv:"\u2ae7",barvee:"\u22bd",barwed:"\u2305",Barwed:"\u2306",barwedge:"\u2305",bbrk:"\u23b5",bbrktbrk:"\u23b6",bcong:"\u224c",Bcy:"\u0411",bcy:"\u0431",bdquo:"\u201e",becaus:"\u2235",because:"\u2235",Because:"\u2235",bemptyv:"\u29b0",bepsi:"\u03f6",bernou:"\u212c",Bernoullis:"\u212c",Beta:"\u0392",beta:"\u03b2",beth:"\u2136",between:"\u226c",Bfr:"\ud835\udd05",bfr:"\ud835\udd1f",bigcap:"\u22c2",bigcirc:"\u25ef",bigcup:"\u22c3",bigodot:"\u2a00",bigoplus:"\u2a01",bigotimes:"\u2a02",bigsqcup:"\u2a06",bigstar:"\u2605",bigtriangledown:"\u25bd",bigtriangleup:"\u25b3",biguplus:"\u2a04",bigvee:"\u22c1",bigwedge:"\u22c0",bkarow:"\u290d",blacklozenge:"\u29eb",blacksquare:"\u25aa",blacktriangle:"\u25b4",blacktriangledown:"\u25be",blacktriangleleft:"\u25c2",blacktriangleright:"\u25b8",blank:"\u2423",blk12:"\u2592",blk14:"\u2591",blk34:"\u2593",block:"\u2588",bne:"=\u20e5",bnequiv:"\u2261\u20e5",bNot:"\u2aed",bnot:"\u2310",Bopf:"\ud835\udd39",bopf:"\ud835\udd53",bot:"\u22a5",bottom:"\u22a5",bowtie:"\u22c8",boxbox:"\u29c9",boxdl:"\u2510",boxdL:"\u2555",boxDl:"\u2556",boxDL:"\u2557",boxdr:"\u250c",boxdR:"\u2552",boxDr:"\u2553",boxDR:"\u2554",boxh:"\u2500",boxH:"\u2550",boxhd:"\u252c",boxHd:"\u2564",boxhD:"\u2565",boxHD:"\u2566",boxhu:"\u2534",boxHu:"\u2567",boxhU:"\u2568",boxHU:"\u2569",boxminus:"\u229f",boxplus:"\u229e",boxtimes:"\u22a0",boxul:"\u2518",boxuL:"\u255b",boxUl:"\u255c",boxUL:"\u255d",boxur:"\u2514",boxuR:"\u2558",boxUr:"\u2559",boxUR:"\u255a",boxv:"\u2502",boxV:"\u2551",boxvh:"\u253c",boxvH:"\u256a",boxVh:"\u256b",boxVH:"\u256c",boxvl:"\u2524",boxvL:"\u2561",boxVl:"\u2562",boxVL:"\u2563",boxvr:"\u251c",boxvR:"\u255e",boxVr:"\u255f",boxVR:"\u2560",bprime:"\u2035",breve:"\u02d8",Breve:"\u02d8",brvbar:"\xa6",bscr:"\ud835\udcb7",Bscr:"\u212c",bsemi:"\u204f",bsim:"\u223d",bsime:"\u22cd",bsolb:"\u29c5",bsol:"\\",bsolhsub:"\u27c8",bull:"\u2022",bullet:"\u2022",bump:"\u224e",bumpE:"\u2aae",bumpe:"\u224f",Bumpeq:"\u224e",bumpeq:"\u224f",Cacute:"\u0106",cacute:"\u0107",capand:"\u2a44",capbrcup:"\u2a49",capcap:"\u2a4b",cap:"\u2229",Cap:"\u22d2",capcup:"\u2a47",capdot:"\u2a40",CapitalDifferentialD:"\u2145",caps:"\u2229\ufe00",caret:"\u2041",caron:"\u02c7",Cayleys:"\u212d",ccaps:"\u2a4d",Ccaron:"\u010c",ccaron:"\u010d",Ccedil:"\xc7",ccedil:"\xe7",Ccirc:"\u0108",ccirc:"\u0109",Cconint:"\u2230",ccups:"\u2a4c",ccupssm:"\u2a50",Cdot:"\u010a",cdot:"\u010b",cedil:"\xb8",Cedilla:"\xb8",cemptyv:"\u29b2",cent:"\xa2",centerdot:"\xb7",CenterDot:"\xb7",cfr:"\ud835\udd20",Cfr:"\u212d",CHcy:"\u0427",chcy:"\u0447",check:"\u2713",checkmark:"\u2713",Chi:"\u03a7",chi:"\u03c7",circ:"\u02c6",circeq:"\u2257",circlearrowleft:"\u21ba",circlearrowright:"\u21bb",circledast:"\u229b",circledcirc:"\u229a",circleddash:"\u229d",CircleDot:"\u2299",circledR:"\xae",circledS:"\u24c8",CircleMinus:"\u2296",CirclePlus:"\u2295",CircleTimes:"\u2297",cir:"\u25cb",cirE:"\u29c3",cire:"\u2257",cirfnint:"\u2a10",cirmid:"\u2aef",cirscir:"\u29c2",ClockwiseContourIntegral:"\u2232",CloseCurlyDoubleQuote:"\u201d",CloseCurlyQuote:"\u2019",clubs:"\u2663",clubsuit:"\u2663",colon:":",Colon:"\u2237",Colone:"\u2a74",colone:"\u2254",coloneq:"\u2254",comma:",",commat:"@",comp:"\u2201",compfn:"\u2218",complement:"\u2201",complexes:"\u2102",cong:"\u2245",congdot:"\u2a6d",Congruent:"\u2261",conint:"\u222e",Conint:"\u222f",ContourIntegral:"\u222e",copf:"\ud835\udd54",Copf:"\u2102",coprod:"\u2210",Coproduct:"\u2210",copy:"\xa9",COPY:"\xa9",copysr:"\u2117",CounterClockwiseContourIntegral:"\u2233",crarr:"\u21b5",cross:"\u2717",Cross:"\u2a2f",Cscr:"\ud835\udc9e",cscr:"\ud835\udcb8",csub:"\u2acf",csube:"\u2ad1",csup:"\u2ad0",csupe:"\u2ad2",ctdot:"\u22ef",cudarrl:"\u2938",cudarrr:"\u2935",cuepr:"\u22de",cuesc:"\u22df",cularr:"\u21b6",cularrp:"\u293d",cupbrcap:"\u2a48",cupcap:"\u2a46",CupCap:"\u224d",cup:"\u222a",Cup:"\u22d3",cupcup:"\u2a4a",cupdot:"\u228d",cupor:"\u2a45",cups:"\u222a\ufe00",curarr:"\u21b7",curarrm:"\u293c",curlyeqprec:"\u22de",curlyeqsucc:"\u22df",curlyvee:"\u22ce",curlywedge:"\u22cf",curren:"\xa4",curvearrowleft:"\u21b6",curvearrowright:"\u21b7",cuvee:"\u22ce",cuwed:"\u22cf",cwconint:"\u2232",cwint:"\u2231",cylcty:"\u232d",dagger:"\u2020",Dagger:"\u2021",daleth:"\u2138",darr:"\u2193",Darr:"\u21a1",dArr:"\u21d3",dash:"\u2010",Dashv:"\u2ae4",dashv:"\u22a3",dbkarow:"\u290f",dblac:"\u02dd",Dcaron:"\u010e",dcaron:"\u010f",Dcy:"\u0414",dcy:"\u0434",ddagger:"\u2021",ddarr:"\u21ca",DD:"\u2145",dd:"\u2146",DDotrahd:"\u2911",ddotseq:"\u2a77",deg:"\xb0",Del:"\u2207",Delta:"\u0394",delta:"\u03b4",demptyv:"\u29b1",dfisht:"\u297f",Dfr:"\ud835\udd07",dfr:"\ud835\udd21",dHar:"\u2965",dharl:"\u21c3",dharr:"\u21c2",DiacriticalAcute:"\xb4",DiacriticalDot:"\u02d9",DiacriticalDoubleAcute:"\u02dd",DiacriticalGrave:"`",DiacriticalTilde:"\u02dc",diam:"\u22c4",diamond:"\u22c4",Diamond:"\u22c4",diamondsuit:"\u2666",diams:"\u2666",die:"\xa8",DifferentialD:"\u2146",digamma:"\u03dd",disin:"\u22f2",div:"\xf7",divide:"\xf7",divideontimes:"\u22c7",divonx:"\u22c7",DJcy:"\u0402",djcy:"\u0452",dlcorn:"\u231e",dlcrop:"\u230d",dollar:"$",Dopf:"\ud835\udd3b",dopf:"\ud835\udd55",Dot:"\xa8",dot:"\u02d9",DotDot:"\u20dc",doteq:"\u2250",doteqdot:"\u2251",DotEqual:"\u2250",dotminus:"\u2238",dotplus:"\u2214",dotsquare:"\u22a1",doublebarwedge:"\u2306",DoubleContourIntegral:"\u222f",DoubleDot:"\xa8",DoubleDownArrow:"\u21d3",DoubleLeftArrow:"\u21d0",DoubleLeftRightArrow:"\u21d4",DoubleLeftTee:"\u2ae4",DoubleLongLeftArrow:"\u27f8",DoubleLongLeftRightArrow:"\u27fa",DoubleLongRightArrow:"\u27f9",DoubleRightArrow:"\u21d2",DoubleRightTee:"\u22a8",DoubleUpArrow:"\u21d1",DoubleUpDownArrow:"\u21d5",DoubleVerticalBar:"\u2225",DownArrowBar:"\u2913",downarrow:"\u2193",DownArrow:"\u2193",Downarrow:"\u21d3",DownArrowUpArrow:"\u21f5",DownBreve:"\u0311",downdownarrows:"\u21ca",downharpoonleft:"\u21c3",downharpoonright:"\u21c2",DownLeftRightVector:"\u2950",DownLeftTeeVector:"\u295e",DownLeftVectorBar:"\u2956",DownLeftVector:"\u21bd",DownRightTeeVector:"\u295f",DownRightVectorBar:"\u2957",DownRightVector:"\u21c1",DownTeeArrow:"\u21a7",DownTee:"\u22a4",drbkarow:"\u2910",drcorn:"\u231f",drcrop:"\u230c",Dscr:"\ud835\udc9f",dscr:"\ud835\udcb9",DScy:"\u0405",dscy:"\u0455",dsol:"\u29f6",Dstrok:"\u0110",dstrok:"\u0111",dtdot:"\u22f1",dtri:"\u25bf",dtrif:"\u25be",duarr:"\u21f5",duhar:"\u296f",dwangle:"\u29a6",DZcy:"\u040f",dzcy:"\u045f",dzigrarr:"\u27ff",Eacute:"\xc9",eacute:"\xe9",easter:"\u2a6e",Ecaron:"\u011a",ecaron:"\u011b",Ecirc:"\xca",ecirc:"\xea",ecir:"\u2256",ecolon:"\u2255",Ecy:"\u042d",ecy:"\u044d",eDDot:"\u2a77",Edot:"\u0116",edot:"\u0117",eDot:"\u2251",ee:"\u2147",efDot:"\u2252",Efr:"\ud835\udd08",efr:"\ud835\udd22",eg:"\u2a9a",Egrave:"\xc8",egrave:"\xe8",egs:"\u2a96",egsdot:"\u2a98",el:"\u2a99",Element:"\u2208",elinters:"\u23e7",ell:"\u2113",els:"\u2a95",elsdot:"\u2a97",Emacr:"\u0112",emacr:"\u0113",empty:"\u2205",emptyset:"\u2205",EmptySmallSquare:"\u25fb",emptyv:"\u2205",EmptyVerySmallSquare:"\u25ab",emsp13:"\u2004",emsp14:"\u2005",emsp:"\u2003",ENG:"\u014a",eng:"\u014b",ensp:"\u2002",Eogon:"\u0118",eogon:"\u0119",Eopf:"\ud835\udd3c",eopf:"\ud835\udd56",epar:"\u22d5",eparsl:"\u29e3",eplus:"\u2a71",epsi:"\u03b5",Epsilon:"\u0395",epsilon:"\u03b5",epsiv:"\u03f5",eqcirc:"\u2256",eqcolon:"\u2255",eqsim:"\u2242",eqslantgtr:"\u2a96",eqslantless:"\u2a95",Equal:"\u2a75",equals:"=",EqualTilde:"\u2242",equest:"\u225f",Equilibrium:"\u21cc",equiv:"\u2261",equivDD:"\u2a78",eqvparsl:"\u29e5",erarr:"\u2971",erDot:"\u2253",escr:"\u212f",Escr:"\u2130",esdot:"\u2250",Esim:"\u2a73",esim:"\u2242",Eta:"\u0397",eta:"\u03b7",ETH:"\xd0",eth:"\xf0",Euml:"\xcb",euml:"\xeb",euro:"\u20ac",excl:"!",exist:"\u2203",Exists:"\u2203",expectation:"\u2130",exponentiale:"\u2147",ExponentialE:"\u2147",fallingdotseq:"\u2252",Fcy:"\u0424",fcy:"\u0444",female:"\u2640",ffilig:"\ufb03",fflig:"\ufb00",ffllig:"\ufb04",Ffr:"\ud835\udd09",ffr:"\ud835\udd23",filig:"\ufb01",FilledSmallSquare:"\u25fc",FilledVerySmallSquare:"\u25aa",fjlig:"fj",flat:"\u266d",fllig:"\ufb02",fltns:"\u25b1",fnof:"\u0192",Fopf:"\ud835\udd3d",fopf:"\ud835\udd57",forall:"\u2200",ForAll:"\u2200",fork:"\u22d4",forkv:"\u2ad9",Fouriertrf:"\u2131",fpartint:"\u2a0d",frac12:"\xbd",frac13:"\u2153",frac14:"\xbc",frac15:"\u2155",frac16:"\u2159",frac18:"\u215b",frac23:"\u2154",frac25:"\u2156",frac34:"\xbe",frac35:"\u2157",frac38:"\u215c",frac45:"\u2158",frac56:"\u215a",frac58:"\u215d",frac78:"\u215e",frasl:"\u2044",frown:"\u2322",fscr:"\ud835\udcbb",Fscr:"\u2131",gacute:"\u01f5",Gamma:"\u0393",gamma:"\u03b3",Gammad:"\u03dc",gammad:"\u03dd",gap:"\u2a86",Gbreve:"\u011e",gbreve:"\u011f",Gcedil:"\u0122",Gcirc:"\u011c",gcirc:"\u011d",Gcy:"\u0413",gcy:"\u0433",Gdot:"\u0120",gdot:"\u0121",ge:"\u2265",gE:"\u2267",gEl:"\u2a8c",gel:"\u22db",geq:"\u2265",geqq:"\u2267",geqslant:"\u2a7e",gescc:"\u2aa9",ges:"\u2a7e",gesdot:"\u2a80",gesdoto:"\u2a82",gesdotol:"\u2a84",gesl:"\u22db\ufe00",gesles:"\u2a94",Gfr:"\ud835\udd0a",gfr:"\ud835\udd24",gg:"\u226b",Gg:"\u22d9",ggg:"\u22d9",gimel:"\u2137",GJcy:"\u0403",gjcy:"\u0453",gla:"\u2aa5",gl:"\u2277",glE:"\u2a92",glj:"\u2aa4",gnap:"\u2a8a",gnapprox:"\u2a8a",gne:"\u2a88",gnE:"\u2269",gneq:"\u2a88",gneqq:"\u2269",gnsim:"\u22e7",Gopf:"\ud835\udd3e",gopf:"\ud835\udd58",grave:"`",GreaterEqual:"\u2265",GreaterEqualLess:"\u22db",GreaterFullEqual:"\u2267",GreaterGreater:"\u2aa2",GreaterLess:"\u2277",GreaterSlantEqual:"\u2a7e",GreaterTilde:"\u2273",Gscr:"\ud835\udca2",gscr:"\u210a",gsim:"\u2273",gsime:"\u2a8e",gsiml:"\u2a90",gtcc:"\u2aa7",gtcir:"\u2a7a",gt:">",GT:">",Gt:"\u226b",gtdot:"\u22d7",gtlPar:"\u2995",gtquest:"\u2a7c",gtrapprox:"\u2a86",gtrarr:"\u2978",gtrdot:"\u22d7",gtreqless:"\u22db",gtreqqless:"\u2a8c",gtrless:"\u2277",gtrsim:"\u2273",gvertneqq:"\u2269\ufe00",gvnE:"\u2269\ufe00",Hacek:"\u02c7",hairsp:"\u200a",half:"\xbd",hamilt:"\u210b",HARDcy:"\u042a",hardcy:"\u044a",harrcir:"\u2948",harr:"\u2194",hArr:"\u21d4",harrw:"\u21ad",Hat:"^",hbar:"\u210f",Hcirc:"\u0124",hcirc:"\u0125",hearts:"\u2665",heartsuit:"\u2665",hellip:"\u2026",hercon:"\u22b9",hfr:"\ud835\udd25",Hfr:"\u210c",HilbertSpace:"\u210b",hksearow:"\u2925",hkswarow:"\u2926",hoarr:"\u21ff",homtht:"\u223b",hookleftarrow:"\u21a9",hookrightarrow:"\u21aa",hopf:"\ud835\udd59",Hopf:"\u210d",horbar:"\u2015",HorizontalLine:"\u2500",hscr:"\ud835\udcbd",Hscr:"\u210b",hslash:"\u210f",Hstrok:"\u0126",hstrok:"\u0127",HumpDownHump:"\u224e",HumpEqual:"\u224f",hybull:"\u2043",hyphen:"\u2010",Iacute:"\xcd",iacute:"\xed",ic:"\u2063",Icirc:"\xce",icirc:"\xee",Icy:"\u0418",icy:"\u0438",Idot:"\u0130",IEcy:"\u0415",iecy:"\u0435",iexcl:"\xa1",iff:"\u21d4",ifr:"\ud835\udd26",Ifr:"\u2111",Igrave:"\xcc",igrave:"\xec",ii:"\u2148",iiiint:"\u2a0c",iiint:"\u222d",iinfin:"\u29dc",iiota:"\u2129",IJlig:"\u0132",ijlig:"\u0133",Imacr:"\u012a",imacr:"\u012b",image:"\u2111",ImaginaryI:"\u2148",imagline:"\u2110",imagpart:"\u2111",imath:"\u0131",Im:"\u2111",imof:"\u22b7",imped:"\u01b5",Implies:"\u21d2",incare:"\u2105",in:"\u2208",infin:"\u221e",infintie:"\u29dd",inodot:"\u0131",intcal:"\u22ba",int:"\u222b",Int:"\u222c",integers:"\u2124",Integral:"\u222b",intercal:"\u22ba",Intersection:"\u22c2",intlarhk:"\u2a17",intprod:"\u2a3c",InvisibleComma:"\u2063",InvisibleTimes:"\u2062",IOcy:"\u0401",iocy:"\u0451",Iogon:"\u012e",iogon:"\u012f",Iopf:"\ud835\udd40",iopf:"\ud835\udd5a",Iota:"\u0399",iota:"\u03b9",iprod:"\u2a3c",iquest:"\xbf",iscr:"\ud835\udcbe",Iscr:"\u2110",isin:"\u2208",isindot:"\u22f5",isinE:"\u22f9",isins:"\u22f4",isinsv:"\u22f3",isinv:"\u2208",it:"\u2062",Itilde:"\u0128",itilde:"\u0129",Iukcy:"\u0406",iukcy:"\u0456",Iuml:"\xcf",iuml:"\xef",Jcirc:"\u0134",jcirc:"\u0135",Jcy:"\u0419",jcy:"\u0439",Jfr:"\ud835\udd0d",jfr:"\ud835\udd27",jmath:"\u0237",Jopf:"\ud835\udd41",jopf:"\ud835\udd5b",Jscr:"\ud835\udca5",jscr:"\ud835\udcbf",Jsercy:"\u0408",jsercy:"\u0458",Jukcy:"\u0404",jukcy:"\u0454",Kappa:"\u039a",kappa:"\u03ba",kappav:"\u03f0",Kcedil:"\u0136",kcedil:"\u0137",Kcy:"\u041a",kcy:"\u043a",Kfr:"\ud835\udd0e",kfr:"\ud835\udd28",kgreen:"\u0138",KHcy:"\u0425",khcy:"\u0445",KJcy:"\u040c",kjcy:"\u045c",Kopf:"\ud835\udd42",kopf:"\ud835\udd5c",Kscr:"\ud835\udca6",kscr:"\ud835\udcc0",lAarr:"\u21da",Lacute:"\u0139",lacute:"\u013a",laemptyv:"\u29b4",lagran:"\u2112",Lambda:"\u039b",lambda:"\u03bb",lang:"\u27e8",Lang:"\u27ea",langd:"\u2991",langle:"\u27e8",lap:"\u2a85",Laplacetrf:"\u2112",laquo:"\xab",larrb:"\u21e4",larrbfs:"\u291f",larr:"\u2190",Larr:"\u219e",lArr:"\u21d0",larrfs:"\u291d",larrhk:"\u21a9",larrlp:"\u21ab",larrpl:"\u2939",larrsim:"\u2973",larrtl:"\u21a2",latail:"\u2919",lAtail:"\u291b",lat:"\u2aab",late:"\u2aad",lates:"\u2aad\ufe00",lbarr:"\u290c",lBarr:"\u290e",lbbrk:"\u2772",lbrace:"{",lbrack:"[",lbrke:"\u298b",lbrksld:"\u298f",lbrkslu:"\u298d",Lcaron:"\u013d",lcaron:"\u013e",Lcedil:"\u013b",lcedil:"\u013c",lceil:"\u2308",lcub:"{",Lcy:"\u041b",lcy:"\u043b",ldca:"\u2936",ldquo:"\u201c",ldquor:"\u201e",ldrdhar:"\u2967",ldrushar:"\u294b",ldsh:"\u21b2",le:"\u2264",lE:"\u2266",LeftAngleBracket:"\u27e8",LeftArrowBar:"\u21e4",leftarrow:"\u2190",LeftArrow:"\u2190",Leftarrow:"\u21d0",LeftArrowRightArrow:"\u21c6",leftarrowtail:"\u21a2",LeftCeiling:"\u2308",LeftDoubleBracket:"\u27e6",LeftDownTeeVector:"\u2961",LeftDownVectorBar:"\u2959",LeftDownVector:"\u21c3",LeftFloor:"\u230a",leftharpoondown:"\u21bd",leftharpoonup:"\u21bc",leftleftarrows:"\u21c7",leftrightarrow:"\u2194",LeftRightArrow:"\u2194",Leftrightarrow:"\u21d4",leftrightarrows:"\u21c6",leftrightharpoons:"\u21cb",leftrightsquigarrow:"\u21ad",LeftRightVector:"\u294e",LeftTeeArrow:"\u21a4",LeftTee:"\u22a3",LeftTeeVector:"\u295a",leftthreetimes:"\u22cb",LeftTriangleBar:"\u29cf",LeftTriangle:"\u22b2",LeftTriangleEqual:"\u22b4",LeftUpDownVector:"\u2951",LeftUpTeeVector:"\u2960",LeftUpVectorBar:"\u2958",LeftUpVector:"\u21bf",LeftVectorBar:"\u2952",LeftVector:"\u21bc",lEg:"\u2a8b",leg:"\u22da",leq:"\u2264",leqq:"\u2266",leqslant:"\u2a7d",lescc:"\u2aa8",les:"\u2a7d",lesdot:"\u2a7f",lesdoto:"\u2a81",lesdotor:"\u2a83",lesg:"\u22da\ufe00",lesges:"\u2a93",lessapprox:"\u2a85",lessdot:"\u22d6",lesseqgtr:"\u22da",lesseqqgtr:"\u2a8b",LessEqualGreater:"\u22da",LessFullEqual:"\u2266",LessGreater:"\u2276",lessgtr:"\u2276",LessLess:"\u2aa1",lesssim:"\u2272",LessSlantEqual:"\u2a7d",LessTilde:"\u2272",lfisht:"\u297c",lfloor:"\u230a",Lfr:"\ud835\udd0f",lfr:"\ud835\udd29",lg:"\u2276",lgE:"\u2a91",lHar:"\u2962",lhard:"\u21bd",lharu:"\u21bc",lharul:"\u296a",lhblk:"\u2584",LJcy:"\u0409",ljcy:"\u0459",llarr:"\u21c7",ll:"\u226a",Ll:"\u22d8",llcorner:"\u231e",Lleftarrow:"\u21da",llhard:"\u296b",lltri:"\u25fa",Lmidot:"\u013f",lmidot:"\u0140",lmoustache:"\u23b0",lmoust:"\u23b0",lnap:"\u2a89",lnapprox:"\u2a89",lne:"\u2a87",lnE:"\u2268",lneq:"\u2a87",lneqq:"\u2268",lnsim:"\u22e6",loang:"\u27ec",loarr:"\u21fd",lobrk:"\u27e6",longleftarrow:"\u27f5",LongLeftArrow:"\u27f5",Longleftarrow:"\u27f8",longleftrightarrow:"\u27f7",LongLeftRightArrow:"\u27f7",Longleftrightarrow:"\u27fa",longmapsto:"\u27fc",longrightarrow:"\u27f6",LongRightArrow:"\u27f6",Longrightarrow:"\u27f9",looparrowleft:"\u21ab",looparrowright:"\u21ac",lopar:"\u2985",Lopf:"\ud835\udd43",lopf:"\ud835\udd5d",loplus:"\u2a2d",lotimes:"\u2a34",lowast:"\u2217",lowbar:"_",LowerLeftArrow:"\u2199",LowerRightArrow:"\u2198",loz:"\u25ca",lozenge:"\u25ca",lozf:"\u29eb",lpar:"(",lparlt:"\u2993",lrarr:"\u21c6",lrcorner:"\u231f",lrhar:"\u21cb",lrhard:"\u296d",lrm:"\u200e",lrtri:"\u22bf",lsaquo:"\u2039",lscr:"\ud835\udcc1",Lscr:"\u2112",lsh:"\u21b0",Lsh:"\u21b0",lsim:"\u2272",lsime:"\u2a8d",lsimg:"\u2a8f",lsqb:"[",lsquo:"\u2018",lsquor:"\u201a",Lstrok:"\u0141",lstrok:"\u0142",ltcc:"\u2aa6",ltcir:"\u2a79",lt:"<",LT:"<",Lt:"\u226a",ltdot:"\u22d6",lthree:"\u22cb",ltimes:"\u22c9",ltlarr:"\u2976",ltquest:"\u2a7b",ltri:"\u25c3",ltrie:"\u22b4",ltrif:"\u25c2",ltrPar:"\u2996",lurdshar:"\u294a",luruhar:"\u2966",lvertneqq:"\u2268\ufe00",lvnE:"\u2268\ufe00",macr:"\xaf",male:"\u2642",malt:"\u2720",maltese:"\u2720",Map:"\u2905",map:"\u21a6",mapsto:"\u21a6",mapstodown:"\u21a7",mapstoleft:"\u21a4",mapstoup:"\u21a5",marker:"\u25ae",mcomma:"\u2a29",Mcy:"\u041c",mcy:"\u043c",mdash:"\u2014",mDDot:"\u223a",measuredangle:"\u2221",MediumSpace:"\u205f",Mellintrf:"\u2133",Mfr:"\ud835\udd10",mfr:"\ud835\udd2a",mho:"\u2127",micro:"\xb5",midast:"*",midcir:"\u2af0",mid:"\u2223",middot:"\xb7",minusb:"\u229f",minus:"\u2212",minusd:"\u2238",minusdu:"\u2a2a",MinusPlus:"\u2213",mlcp:"\u2adb",mldr:"\u2026",mnplus:"\u2213",models:"\u22a7",Mopf:"\ud835\udd44",mopf:"\ud835\udd5e",mp:"\u2213",mscr:"\ud835\udcc2",Mscr:"\u2133",mstpos:"\u223e",Mu:"\u039c",mu:"\u03bc",multimap:"\u22b8",mumap:"\u22b8",nabla:"\u2207",Nacute:"\u0143",nacute:"\u0144",nang:"\u2220\u20d2",nap:"\u2249",napE:"\u2a70\u0338",napid:"\u224b\u0338",napos:"\u0149",napprox:"\u2249",natural:"\u266e",naturals:"\u2115",natur:"\u266e",nbsp:"\xa0",nbump:"\u224e\u0338",nbumpe:"\u224f\u0338",ncap:"\u2a43",Ncaron:"\u0147",ncaron:"\u0148",Ncedil:"\u0145",ncedil:"\u0146",ncong:"\u2247",ncongdot:"\u2a6d\u0338",ncup:"\u2a42",Ncy:"\u041d",ncy:"\u043d",ndash:"\u2013",nearhk:"\u2924",nearr:"\u2197",neArr:"\u21d7",nearrow:"\u2197",ne:"\u2260",nedot:"\u2250\u0338",NegativeMediumSpace:"\u200b",NegativeThickSpace:"\u200b",NegativeThinSpace:"\u200b",NegativeVeryThinSpace:"\u200b",nequiv:"\u2262",nesear:"\u2928",nesim:"\u2242\u0338",NestedGreaterGreater:"\u226b",NestedLessLess:"\u226a",NewLine:"\n",nexist:"\u2204",nexists:"\u2204",Nfr:"\ud835\udd11",nfr:"\ud835\udd2b",ngE:"\u2267\u0338",nge:"\u2271",ngeq:"\u2271",ngeqq:"\u2267\u0338",ngeqslant:"\u2a7e\u0338",nges:"\u2a7e\u0338",nGg:"\u22d9\u0338",ngsim:"\u2275",nGt:"\u226b\u20d2",ngt:"\u226f",ngtr:"\u226f",nGtv:"\u226b\u0338",nharr:"\u21ae",nhArr:"\u21ce",nhpar:"\u2af2",ni:"\u220b",nis:"\u22fc",nisd:"\u22fa",niv:"\u220b",NJcy:"\u040a",njcy:"\u045a",nlarr:"\u219a",nlArr:"\u21cd",nldr:"\u2025",nlE:"\u2266\u0338",nle:"\u2270",nleftarrow:"\u219a",nLeftarrow:"\u21cd",nleftrightarrow:"\u21ae",nLeftrightarrow:"\u21ce",nleq:"\u2270",nleqq:"\u2266\u0338",nleqslant:"\u2a7d\u0338",nles:"\u2a7d\u0338",nless:"\u226e",nLl:"\u22d8\u0338",nlsim:"\u2274",nLt:"\u226a\u20d2",nlt:"\u226e",nltri:"\u22ea",nltrie:"\u22ec",nLtv:"\u226a\u0338",nmid:"\u2224",NoBreak:"\u2060",NonBreakingSpace:"\xa0",nopf:"\ud835\udd5f",Nopf:"\u2115",Not:"\u2aec",not:"\xac",NotCongruent:"\u2262",NotCupCap:"\u226d",NotDoubleVerticalBar:"\u2226",NotElement:"\u2209",NotEqual:"\u2260",NotEqualTilde:"\u2242\u0338",NotExists:"\u2204",NotGreater:"\u226f",NotGreaterEqual:"\u2271",NotGreaterFullEqual:"\u2267\u0338",NotGreaterGreater:"\u226b\u0338",NotGreaterLess:"\u2279",NotGreaterSlantEqual:"\u2a7e\u0338",NotGreaterTilde:"\u2275",NotHumpDownHump:"\u224e\u0338",NotHumpEqual:"\u224f\u0338",notin:"\u2209",notindot:"\u22f5\u0338",notinE:"\u22f9\u0338",notinva:"\u2209",notinvb:"\u22f7",notinvc:"\u22f6",NotLeftTriangleBar:"\u29cf\u0338",NotLeftTriangle:"\u22ea",NotLeftTriangleEqual:"\u22ec",NotLess:"\u226e",NotLessEqual:"\u2270",NotLessGreater:"\u2278",NotLessLess:"\u226a\u0338",NotLessSlantEqual:"\u2a7d\u0338",NotLessTilde:"\u2274",NotNestedGreaterGreater:"\u2aa2\u0338",NotNestedLessLess:"\u2aa1\u0338",notni:"\u220c",notniva:"\u220c",notnivb:"\u22fe",notnivc:"\u22fd",NotPrecedes:"\u2280",NotPrecedesEqual:"\u2aaf\u0338",NotPrecedesSlantEqual:"\u22e0",NotReverseElement:"\u220c",NotRightTriangleBar:"\u29d0\u0338",NotRightTriangle:"\u22eb",NotRightTriangleEqual:"\u22ed",NotSquareSubset:"\u228f\u0338",NotSquareSubsetEqual:"\u22e2",NotSquareSuperset:"\u2290\u0338",NotSquareSupersetEqual:"\u22e3",NotSubset:"\u2282\u20d2",NotSubsetEqual:"\u2288",NotSucceeds:"\u2281",NotSucceedsEqual:"\u2ab0\u0338",NotSucceedsSlantEqual:"\u22e1",NotSucceedsTilde:"\u227f\u0338",NotSuperset:"\u2283\u20d2",NotSupersetEqual:"\u2289",NotTilde:"\u2241",NotTildeEqual:"\u2244",NotTildeFullEqual:"\u2247",NotTildeTilde:"\u2249",NotVerticalBar:"\u2224",nparallel:"\u2226",npar:"\u2226",nparsl:"\u2afd\u20e5",npart:"\u2202\u0338",npolint:"\u2a14",npr:"\u2280",nprcue:"\u22e0",nprec:"\u2280",npreceq:"\u2aaf\u0338",npre:"\u2aaf\u0338",nrarrc:"\u2933\u0338",nrarr:"\u219b",nrArr:"\u21cf",nrarrw:"\u219d\u0338",nrightarrow:"\u219b",nRightarrow:"\u21cf",nrtri:"\u22eb",nrtrie:"\u22ed",nsc:"\u2281",nsccue:"\u22e1",nsce:"\u2ab0\u0338",Nscr:"\ud835\udca9",nscr:"\ud835\udcc3",nshortmid:"\u2224",nshortparallel:"\u2226",nsim:"\u2241",nsime:"\u2244",nsimeq:"\u2244",nsmid:"\u2224",nspar:"\u2226",nsqsube:"\u22e2",nsqsupe:"\u22e3",nsub:"\u2284",nsubE:"\u2ac5\u0338",nsube:"\u2288",nsubset:"\u2282\u20d2",nsubseteq:"\u2288",nsubseteqq:"\u2ac5\u0338",nsucc:"\u2281",nsucceq:"\u2ab0\u0338",nsup:"\u2285",nsupE:"\u2ac6\u0338",nsupe:"\u2289",nsupset:"\u2283\u20d2",nsupseteq:"\u2289",nsupseteqq:"\u2ac6\u0338",ntgl:"\u2279",Ntilde:"\xd1",ntilde:"\xf1",ntlg:"\u2278",ntriangleleft:"\u22ea",ntrianglelefteq:"\u22ec",ntriangleright:"\u22eb",ntrianglerighteq:"\u22ed",Nu:"\u039d",nu:"\u03bd",num:"#",numero:"\u2116",numsp:"\u2007",nvap:"\u224d\u20d2",nvdash:"\u22ac",nvDash:"\u22ad",nVdash:"\u22ae",nVDash:"\u22af",nvge:"\u2265\u20d2",nvgt:">\u20d2",nvHarr:"\u2904",nvinfin:"\u29de",nvlArr:"\u2902",nvle:"\u2264\u20d2",nvlt:"<\u20d2",nvltrie:"\u22b4\u20d2",nvrArr:"\u2903",nvrtrie:"\u22b5\u20d2",nvsim:"\u223c\u20d2",nwarhk:"\u2923",nwarr:"\u2196",nwArr:"\u21d6",nwarrow:"\u2196",nwnear:"\u2927",Oacute:"\xd3",oacute:"\xf3",oast:"\u229b",Ocirc:"\xd4",ocirc:"\xf4",ocir:"\u229a",Ocy:"\u041e",ocy:"\u043e",odash:"\u229d",Odblac:"\u0150",odblac:"\u0151",odiv:"\u2a38",odot:"\u2299",odsold:"\u29bc",OElig:"\u0152",oelig:"\u0153",ofcir:"\u29bf",Ofr:"\ud835\udd12",ofr:"\ud835\udd2c",ogon:"\u02db",Ograve:"\xd2",ograve:"\xf2",ogt:"\u29c1",ohbar:"\u29b5",ohm:"\u03a9",oint:"\u222e",olarr:"\u21ba",olcir:"\u29be",olcross:"\u29bb",oline:"\u203e",olt:"\u29c0",Omacr:"\u014c",omacr:"\u014d",Omega:"\u03a9",omega:"\u03c9",Omicron:"\u039f",omicron:"\u03bf",omid:"\u29b6",ominus:"\u2296",Oopf:"\ud835\udd46",oopf:"\ud835\udd60",opar:"\u29b7",OpenCurlyDoubleQuote:"\u201c",OpenCurlyQuote:"\u2018",operp:"\u29b9",oplus:"\u2295",orarr:"\u21bb",Or:"\u2a54",or:"\u2228",ord:"\u2a5d",order:"\u2134",orderof:"\u2134",ordf:"\xaa",ordm:"\xba",origof:"\u22b6",oror:"\u2a56",orslope:"\u2a57",orv:"\u2a5b",oS:"\u24c8",Oscr:"\ud835\udcaa",oscr:"\u2134",Oslash:"\xd8",oslash:"\xf8",osol:"\u2298",Otilde:"\xd5",otilde:"\xf5",otimesas:"\u2a36",Otimes:"\u2a37",otimes:"\u2297",Ouml:"\xd6",ouml:"\xf6",ovbar:"\u233d",OverBar:"\u203e",OverBrace:"\u23de",OverBracket:"\u23b4",OverParenthesis:"\u23dc",para:"\xb6",parallel:"\u2225",par:"\u2225",parsim:"\u2af3",parsl:"\u2afd",part:"\u2202",PartialD:"\u2202",Pcy:"\u041f",pcy:"\u043f",percnt:"%",period:".",permil:"\u2030",perp:"\u22a5",pertenk:"\u2031",Pfr:"\ud835\udd13",pfr:"\ud835\udd2d",Phi:"\u03a6",phi:"\u03c6",phiv:"\u03d5",phmmat:"\u2133",phone:"\u260e",Pi:"\u03a0",pi:"\u03c0",pitchfork:"\u22d4",piv:"\u03d6",planck:"\u210f",planckh:"\u210e",plankv:"\u210f",plusacir:"\u2a23",plusb:"\u229e",pluscir:"\u2a22",plus:"+",plusdo:"\u2214",plusdu:"\u2a25",pluse:"\u2a72",PlusMinus:"\xb1",plusmn:"\xb1",plussim:"\u2a26",plustwo:"\u2a27",pm:"\xb1",Poincareplane:"\u210c",pointint:"\u2a15",popf:"\ud835\udd61",Popf:"\u2119",pound:"\xa3",prap:"\u2ab7",Pr:"\u2abb",pr:"\u227a",prcue:"\u227c",precapprox:"\u2ab7",prec:"\u227a",preccurlyeq:"\u227c",Precedes:"\u227a",PrecedesEqual:"\u2aaf",PrecedesSlantEqual:"\u227c",PrecedesTilde:"\u227e",preceq:"\u2aaf",precnapprox:"\u2ab9",precneqq:"\u2ab5",precnsim:"\u22e8",pre:"\u2aaf",prE:"\u2ab3",precsim:"\u227e",prime:"\u2032",Prime:"\u2033",primes:"\u2119",prnap:"\u2ab9",prnE:"\u2ab5",prnsim:"\u22e8",prod:"\u220f",Product:"\u220f",profalar:"\u232e",profline:"\u2312",profsurf:"\u2313",prop:"\u221d",Proportional:"\u221d",Proportion:"\u2237",propto:"\u221d",prsim:"\u227e",prurel:"\u22b0",Pscr:"\ud835\udcab",pscr:"\ud835\udcc5",Psi:"\u03a8",psi:"\u03c8",puncsp:"\u2008",Qfr:"\ud835\udd14",qfr:"\ud835\udd2e",qint:"\u2a0c",qopf:"\ud835\udd62",Qopf:"\u211a",qprime:"\u2057",Qscr:"\ud835\udcac",qscr:"\ud835\udcc6",quaternions:"\u210d",quatint:"\u2a16",quest:"?",questeq:"\u225f",quot:'"',QUOT:'"',rAarr:"\u21db",race:"\u223d\u0331",Racute:"\u0154",racute:"\u0155",radic:"\u221a",raemptyv:"\u29b3",rang:"\u27e9",Rang:"\u27eb",rangd:"\u2992",range:"\u29a5",rangle:"\u27e9",raquo:"\xbb",rarrap:"\u2975",rarrb:"\u21e5",rarrbfs:"\u2920",rarrc:"\u2933",rarr:"\u2192",Rarr:"\u21a0",rArr:"\u21d2",rarrfs:"\u291e",rarrhk:"\u21aa",rarrlp:"\u21ac",rarrpl:"\u2945",rarrsim:"\u2974",Rarrtl:"\u2916",rarrtl:"\u21a3",rarrw:"\u219d",ratail:"\u291a",rAtail:"\u291c",ratio:"\u2236",rationals:"\u211a",rbarr:"\u290d",rBarr:"\u290f",RBarr:"\u2910",rbbrk:"\u2773",rbrace:"}",rbrack:"]",rbrke:"\u298c",rbrksld:"\u298e",rbrkslu:"\u2990",Rcaron:"\u0158",rcaron:"\u0159",Rcedil:"\u0156",rcedil:"\u0157",rceil:"\u2309",rcub:"}",Rcy:"\u0420",rcy:"\u0440",rdca:"\u2937",rdldhar:"\u2969",rdquo:"\u201d",rdquor:"\u201d",rdsh:"\u21b3",real:"\u211c",realine:"\u211b",realpart:"\u211c",reals:"\u211d",Re:"\u211c",rect:"\u25ad",reg:"\xae",REG:"\xae",ReverseElement:"\u220b",ReverseEquilibrium:"\u21cb",ReverseUpEquilibrium:"\u296f",rfisht:"\u297d",rfloor:"\u230b",rfr:"\ud835\udd2f",Rfr:"\u211c",rHar:"\u2964",rhard:"\u21c1",rharu:"\u21c0",rharul:"\u296c",Rho:"\u03a1",rho:"\u03c1",rhov:"\u03f1",RightAngleBracket:"\u27e9",RightArrowBar:"\u21e5",rightarrow:"\u2192",RightArrow:"\u2192",Rightarrow:"\u21d2",RightArrowLeftArrow:"\u21c4",rightarrowtail:"\u21a3",RightCeiling:"\u2309",RightDoubleBracket:"\u27e7",RightDownTeeVector:"\u295d",RightDownVectorBar:"\u2955",RightDownVector:"\u21c2",RightFloor:"\u230b",rightharpoondown:"\u21c1",rightharpoonup:"\u21c0",rightleftarrows:"\u21c4",rightleftharpoons:"\u21cc",rightrightarrows:"\u21c9",rightsquigarrow:"\u219d",RightTeeArrow:"\u21a6",RightTee:"\u22a2",RightTeeVector:"\u295b",rightthreetimes:"\u22cc",RightTriangleBar:"\u29d0",RightTriangle:"\u22b3",RightTriangleEqual:"\u22b5",RightUpDownVector:"\u294f",RightUpTeeVector:"\u295c",RightUpVectorBar:"\u2954",RightUpVector:"\u21be",RightVectorBar:"\u2953",RightVector:"\u21c0",ring:"\u02da",risingdotseq:"\u2253",rlarr:"\u21c4",rlhar:"\u21cc",rlm:"\u200f",rmoustache:"\u23b1",rmoust:"\u23b1",rnmid:"\u2aee",roang:"\u27ed",roarr:"\u21fe",robrk:"\u27e7",ropar:"\u2986",ropf:"\ud835\udd63",Ropf:"\u211d",roplus:"\u2a2e",rotimes:"\u2a35",RoundImplies:"\u2970",rpar:")",rpargt:"\u2994",rppolint:"\u2a12",rrarr:"\u21c9",Rrightarrow:"\u21db",rsaquo:"\u203a",rscr:"\ud835\udcc7",Rscr:"\u211b",rsh:"\u21b1",Rsh:"\u21b1",rsqb:"]",rsquo:"\u2019",rsquor:"\u2019",rthree:"\u22cc",rtimes:"\u22ca",rtri:"\u25b9",rtrie:"\u22b5",rtrif:"\u25b8",rtriltri:"\u29ce",RuleDelayed:"\u29f4",ruluhar:"\u2968",rx:"\u211e",Sacute:"\u015a",sacute:"\u015b",sbquo:"\u201a",scap:"\u2ab8",Scaron:"\u0160",scaron:"\u0161",Sc:"\u2abc",sc:"\u227b",sccue:"\u227d",sce:"\u2ab0",scE:"\u2ab4",Scedil:"\u015e",scedil:"\u015f",Scirc:"\u015c",scirc:"\u015d",scnap:"\u2aba",scnE:"\u2ab6",scnsim:"\u22e9",scpolint:"\u2a13",scsim:"\u227f",Scy:"\u0421",scy:"\u0441",sdotb:"\u22a1",sdot:"\u22c5",sdote:"\u2a66",searhk:"\u2925",searr:"\u2198",seArr:"\u21d8",searrow:"\u2198",sect:"\xa7",semi:";",seswar:"\u2929",setminus:"\u2216",setmn:"\u2216",sext:"\u2736",Sfr:"\ud835\udd16",sfr:"\ud835\udd30",sfrown:"\u2322",sharp:"\u266f",SHCHcy:"\u0429",shchcy:"\u0449",SHcy:"\u0428",shcy:"\u0448",ShortDownArrow:"\u2193",ShortLeftArrow:"\u2190",shortmid:"\u2223",shortparallel:"\u2225",ShortRightArrow:"\u2192",ShortUpArrow:"\u2191",shy:"\xad",Sigma:"\u03a3",sigma:"\u03c3",sigmaf:"\u03c2",sigmav:"\u03c2",sim:"\u223c",simdot:"\u2a6a",sime:"\u2243",simeq:"\u2243",simg:"\u2a9e",simgE:"\u2aa0",siml:"\u2a9d",simlE:"\u2a9f",simne:"\u2246",simplus:"\u2a24",simrarr:"\u2972",slarr:"\u2190",SmallCircle:"\u2218",smallsetminus:"\u2216",smashp:"\u2a33",smeparsl:"\u29e4",smid:"\u2223",smile:"\u2323",smt:"\u2aaa",smte:"\u2aac",smtes:"\u2aac\ufe00",SOFTcy:"\u042c",softcy:"\u044c",solbar:"\u233f",solb:"\u29c4",sol:"/",Sopf:"\ud835\udd4a",sopf:"\ud835\udd64",spades:"\u2660",spadesuit:"\u2660",spar:"\u2225",sqcap:"\u2293",sqcaps:"\u2293\ufe00",sqcup:"\u2294",sqcups:"\u2294\ufe00",Sqrt:"\u221a",sqsub:"\u228f",sqsube:"\u2291",sqsubset:"\u228f",sqsubseteq:"\u2291",sqsup:"\u2290",sqsupe:"\u2292",sqsupset:"\u2290",sqsupseteq:"\u2292",square:"\u25a1",Square:"\u25a1",SquareIntersection:"\u2293",SquareSubset:"\u228f",SquareSubsetEqual:"\u2291",SquareSuperset:"\u2290",SquareSupersetEqual:"\u2292",SquareUnion:"\u2294",squarf:"\u25aa",squ:"\u25a1",squf:"\u25aa",srarr:"\u2192",Sscr:"\ud835\udcae",sscr:"\ud835\udcc8",ssetmn:"\u2216",ssmile:"\u2323",sstarf:"\u22c6",Star:"\u22c6",star:"\u2606",starf:"\u2605",straightepsilon:"\u03f5",straightphi:"\u03d5",strns:"\xaf",sub:"\u2282",Sub:"\u22d0",subdot:"\u2abd",subE:"\u2ac5",sube:"\u2286",subedot:"\u2ac3",submult:"\u2ac1",subnE:"\u2acb",subne:"\u228a",subplus:"\u2abf",subrarr:"\u2979",subset:"\u2282",Subset:"\u22d0",subseteq:"\u2286",subseteqq:"\u2ac5",SubsetEqual:"\u2286",subsetneq:"\u228a",subsetneqq:"\u2acb",subsim:"\u2ac7",subsub:"\u2ad5",subsup:"\u2ad3",succapprox:"\u2ab8",succ:"\u227b",succcurlyeq:"\u227d",Succeeds:"\u227b",SucceedsEqual:"\u2ab0",SucceedsSlantEqual:"\u227d",SucceedsTilde:"\u227f",succeq:"\u2ab0",succnapprox:"\u2aba",succneqq:"\u2ab6",succnsim:"\u22e9",succsim:"\u227f",SuchThat:"\u220b",sum:"\u2211",Sum:"\u2211",sung:"\u266a",sup1:"\xb9",sup2:"\xb2",sup3:"\xb3",sup:"\u2283",Sup:"\u22d1",supdot:"\u2abe",supdsub:"\u2ad8",supE:"\u2ac6",supe:"\u2287",supedot:"\u2ac4",Superset:"\u2283",SupersetEqual:"\u2287",suphsol:"\u27c9",suphsub:"\u2ad7",suplarr:"\u297b",supmult:"\u2ac2",supnE:"\u2acc",supne:"\u228b",supplus:"\u2ac0",supset:"\u2283",Supset:"\u22d1",supseteq:"\u2287",supseteqq:"\u2ac6",supsetneq:"\u228b",supsetneqq:"\u2acc",supsim:"\u2ac8",supsub:"\u2ad4",supsup:"\u2ad6",swarhk:"\u2926",swarr:"\u2199",swArr:"\u21d9",swarrow:"\u2199",swnwar:"\u292a",szlig:"\xdf",Tab:"\t",target:"\u2316",Tau:"\u03a4",tau:"\u03c4",tbrk:"\u23b4",Tcaron:"\u0164",tcaron:"\u0165",Tcedil:"\u0162",tcedil:"\u0163",Tcy:"\u0422",tcy:"\u0442",tdot:"\u20db",telrec:"\u2315",Tfr:"\ud835\udd17",tfr:"\ud835\udd31",there4:"\u2234",therefore:"\u2234",Therefore:"\u2234",Theta:"\u0398",theta:"\u03b8",thetasym:"\u03d1",thetav:"\u03d1",thickapprox:"\u2248",thicksim:"\u223c",ThickSpace:"\u205f\u200a",ThinSpace:"\u2009",thinsp:"\u2009",thkap:"\u2248",thksim:"\u223c",THORN:"\xde",thorn:"\xfe",tilde:"\u02dc",Tilde:"\u223c",TildeEqual:"\u2243",TildeFullEqual:"\u2245",TildeTilde:"\u2248",timesbar:"\u2a31",timesb:"\u22a0",times:"\xd7",timesd:"\u2a30",tint:"\u222d",toea:"\u2928",topbot:"\u2336",topcir:"\u2af1",top:"\u22a4",Topf:"\ud835\udd4b",topf:"\ud835\udd65",topfork:"\u2ada",tosa:"\u2929",tprime:"\u2034",trade:"\u2122",TRADE:"\u2122",triangle:"\u25b5",triangledown:"\u25bf",triangleleft:"\u25c3",trianglelefteq:"\u22b4",triangleq:"\u225c",triangleright:"\u25b9",trianglerighteq:"\u22b5",tridot:"\u25ec",trie:"\u225c",triminus:"\u2a3a",TripleDot:"\u20db",triplus:"\u2a39",trisb:"\u29cd",tritime:"\u2a3b",trpezium:"\u23e2",Tscr:"\ud835\udcaf",tscr:"\ud835\udcc9",TScy:"\u0426",tscy:"\u0446",TSHcy:"\u040b",tshcy:"\u045b",Tstrok:"\u0166",tstrok:"\u0167",twixt:"\u226c",twoheadleftarrow:"\u219e",twoheadrightarrow:"\u21a0",Uacute:"\xda",uacute:"\xfa",uarr:"\u2191",Uarr:"\u219f",uArr:"\u21d1",Uarrocir:"\u2949",Ubrcy:"\u040e",ubrcy:"\u045e",Ubreve:"\u016c",ubreve:"\u016d",Ucirc:"\xdb",ucirc:"\xfb",Ucy:"\u0423",ucy:"\u0443",udarr:"\u21c5",Udblac:"\u0170",udblac:"\u0171",udhar:"\u296e",ufisht:"\u297e",Ufr:"\ud835\udd18",ufr:"\ud835\udd32",Ugrave:"\xd9",ugrave:"\xf9",uHar:"\u2963",uharl:"\u21bf",uharr:"\u21be",uhblk:"\u2580",ulcorn:"\u231c",ulcorner:"\u231c",ulcrop:"\u230f",ultri:"\u25f8",Umacr:"\u016a",umacr:"\u016b",uml:"\xa8",UnderBar:"_",UnderBrace:"\u23df",UnderBracket:"\u23b5",UnderParenthesis:"\u23dd",Union:"\u22c3",UnionPlus:"\u228e",Uogon:"\u0172",uogon:"\u0173",Uopf:"\ud835\udd4c",uopf:"\ud835\udd66",UpArrowBar:"\u2912",uparrow:"\u2191",UpArrow:"\u2191",Uparrow:"\u21d1",UpArrowDownArrow:"\u21c5",updownarrow:"\u2195",UpDownArrow:"\u2195",Updownarrow:"\u21d5",UpEquilibrium:"\u296e",upharpoonleft:"\u21bf",upharpoonright:"\u21be",uplus:"\u228e",UpperLeftArrow:"\u2196",UpperRightArrow:"\u2197",upsi:"\u03c5",Upsi:"\u03d2",upsih:"\u03d2",Upsilon:"\u03a5",upsilon:"\u03c5",UpTeeArrow:"\u21a5",UpTee:"\u22a5",upuparrows:"\u21c8",urcorn:"\u231d",urcorner:"\u231d",urcrop:"\u230e",Uring:"\u016e",uring:"\u016f",urtri:"\u25f9",Uscr:"\ud835\udcb0",uscr:"\ud835\udcca",utdot:"\u22f0",Utilde:"\u0168",utilde:"\u0169",utri:"\u25b5",utrif:"\u25b4",uuarr:"\u21c8",Uuml:"\xdc",uuml:"\xfc",uwangle:"\u29a7",vangrt:"\u299c",varepsilon:"\u03f5",varkappa:"\u03f0",varnothing:"\u2205",varphi:"\u03d5",varpi:"\u03d6",varpropto:"\u221d",varr:"\u2195",vArr:"\u21d5",varrho:"\u03f1",varsigma:"\u03c2",varsubsetneq:"\u228a\ufe00",varsubsetneqq:"\u2acb\ufe00",varsupsetneq:"\u228b\ufe00",varsupsetneqq:"\u2acc\ufe00",vartheta:"\u03d1",vartriangleleft:"\u22b2",vartriangleright:"\u22b3",vBar:"\u2ae8",Vbar:"\u2aeb",vBarv:"\u2ae9",Vcy:"\u0412",vcy:"\u0432",vdash:"\u22a2",vDash:"\u22a8",Vdash:"\u22a9",VDash:"\u22ab",Vdashl:"\u2ae6",veebar:"\u22bb",vee:"\u2228",Vee:"\u22c1",veeeq:"\u225a",vellip:"\u22ee",verbar:"|",Verbar:"\u2016",vert:"|",Vert:"\u2016",VerticalBar:"\u2223",VerticalLine:"|",VerticalSeparator:"\u2758",VerticalTilde:"\u2240",VeryThinSpace:"\u200a",Vfr:"\ud835\udd19",vfr:"\ud835\udd33",vltri:"\u22b2",vnsub:"\u2282\u20d2",vnsup:"\u2283\u20d2",Vopf:"\ud835\udd4d",vopf:"\ud835\udd67",vprop:"\u221d",vrtri:"\u22b3",Vscr:"\ud835\udcb1",vscr:"\ud835\udccb",vsubnE:"\u2acb\ufe00",vsubne:"\u228a\ufe00",vsupnE:"\u2acc\ufe00",vsupne:"\u228b\ufe00",Vvdash:"\u22aa",vzigzag:"\u299a",Wcirc:"\u0174",wcirc:"\u0175",wedbar:"\u2a5f",wedge:"\u2227",Wedge:"\u22c0",wedgeq:"\u2259",weierp:"\u2118",Wfr:"\ud835\udd1a",wfr:"\ud835\udd34",Wopf:"\ud835\udd4e",wopf:"\ud835\udd68",wp:"\u2118",wr:"\u2240",wreath:"\u2240",Wscr:"\ud835\udcb2",wscr:"\ud835\udccc",xcap:"\u22c2",xcirc:"\u25ef",xcup:"\u22c3",xdtri:"\u25bd",Xfr:"\ud835\udd1b",xfr:"\ud835\udd35",xharr:"\u27f7",xhArr:"\u27fa",Xi:"\u039e",xi:"\u03be",xlarr:"\u27f5",xlArr:"\u27f8",xmap:"\u27fc",xnis:"\u22fb",xodot:"\u2a00",Xopf:"\ud835\udd4f",xopf:"\ud835\udd69",xoplus:"\u2a01",xotime:"\u2a02",xrarr:"\u27f6",xrArr:"\u27f9",Xscr:"\ud835\udcb3",xscr:"\ud835\udccd",xsqcup:"\u2a06",xuplus:"\u2a04",xutri:"\u25b3",xvee:"\u22c1",xwedge:"\u22c0",Yacute:"\xdd",yacute:"\xfd",YAcy:"\u042f",yacy:"\u044f",Ycirc:"\u0176",ycirc:"\u0177",Ycy:"\u042b",ycy:"\u044b",yen:"\xa5",Yfr:"\ud835\udd1c",yfr:"\ud835\udd36",YIcy:"\u0407",yicy:"\u0457",Yopf:"\ud835\udd50",yopf:"\ud835\udd6a",Yscr:"\ud835\udcb4",yscr:"\ud835\udcce",YUcy:"\u042e",yucy:"\u044e",yuml:"\xff",Yuml:"\u0178",Zacute:"\u0179",zacute:"\u017a",Zcaron:"\u017d",zcaron:"\u017e",Zcy:"\u0417",zcy:"\u0437",Zdot:"\u017b",zdot:"\u017c",zeetrf:"\u2128",ZeroWidthSpace:"\u200b",Zeta:"\u0396",zeta:"\u03b6",zfr:"\ud835\udd37",Zfr:"\u2128",ZHcy:"\u0416",zhcy:"\u0436",zigrarr:"\u21dd",zopf:"\ud835\udd6b",Zopf:"\u2124",Zscr:"\ud835\udcb5",zscr:"\ud835\udccf",zwj:"\u200d",zwnj:"\u200c"}},{}],53:[function(e,r,t){"use strict";function n(e){return Array.prototype.slice.call(arguments,1).forEach((function(r){r&&Object.keys(r).forEach((function(t){e[t]=r[t]}))})),e}function s(e){return Object.prototype.toString.call(e)}function o(e){return"[object Function]"===s(e)}function i(e){return e.replace(/[.?*+^$[\]\\(){}|-]/g,"\\$&")}var a={fuzzyLink:!0,fuzzyEmail:!0,fuzzyIP:!1};var c={"http:":{validate:function(e,r,t){var n=e.slice(r);return t.re.http||(t.re.http=new RegExp("^\\/\\/"+t.re.src_auth+t.re.src_host_port_strict+t.re.src_path,"i")),t.re.http.test(n)?n.match(t.re.http)[0].length:0}},"https:":"http:","ftp:":"http:","//":{validate:function(e,r,t){var n=e.slice(r);return t.re.no_http||(t.re.no_http=new RegExp("^"+t.re.src_auth+"(?:localhost|(?:(?:"+t.re.src_domain+")\\.)+"+t.re.src_domain_root+")"+t.re.src_port+t.re.src_host_terminator+t.re.src_path,"i")),t.re.no_http.test(n)?r>=3&&":"===e[r-3]?0:r>=3&&"/"===e[r-3]?0:n.match(t.re.no_http)[0].length:0}},"mailto:":{validate:function(e,r,t){var n=e.slice(r);return t.re.mailto||(t.re.mailto=new RegExp("^"+t.re.src_email_name+"@"+t.re.src_host_strict,"i")),t.re.mailto.test(n)?n.match(t.re.mailto)[0].length:0}}},l="a[cdefgilmnoqrstuwxz]|b[abdefghijmnorstvwyz]|c[acdfghiklmnoruvwxyz]|d[ejkmoz]|e[cegrstu]|f[ijkmor]|g[abdefghilmnpqrstuwy]|h[kmnrtu]|i[delmnoqrst]|j[emop]|k[eghimnprwyz]|l[abcikrstuvy]|m[acdeghklmnopqrstuvwxyz]|n[acefgilopruz]|om|p[aefghklmnrstwy]|qa|r[eosuw]|s[abcdeghijklmnortuvxyz]|t[cdfghjklmnortvwz]|u[agksyz]|v[aceginu]|w[fs]|y[et]|z[amw]",u="biz|com|edu|gov|net|org|pro|web|xxx|aero|asia|coop|info|museum|name|shop|\u0440\u0444".split("|");function p(r){var t=r.re=e("./lib/re")(r.__opts__),n=r.__tlds__.slice();function a(e){return e.replace("%TLDS%",t.src_tlds)}r.onCompile(),r.__tlds_replaced__||n.push(l),n.push(t.src_xn),t.src_tlds=n.join("|"),t.email_fuzzy=RegExp(a(t.tpl_email_fuzzy),"i"),t.link_fuzzy=RegExp(a(t.tpl_link_fuzzy),"i"),t.link_no_ip_fuzzy=RegExp(a(t.tpl_link_no_ip_fuzzy),"i"),t.host_fuzzy_test=RegExp(a(t.tpl_host_fuzzy_test),"i");var c=[];function u(e,r){throw new Error('(LinkifyIt) Invalid schema "'+e+'": '+r)}r.__compiled__={},Object.keys(r.__schemas__).forEach((function(e){var t=r.__schemas__[e];if(null!==t){var n={validate:null,link:null};if(r.__compiled__[e]=n,"[object Object]"===s(t))return!function(e){return"[object RegExp]"===s(e)}(t.validate)?o(t.validate)?n.validate=t.validate:u(e,t):n.validate=function(e){return function(r,t){var n=r.slice(t);return e.test(n)?n.match(e)[0].length:0}}(t.validate),void(o(t.normalize)?n.normalize=t.normalize:t.normalize?u(e,t):n.normalize=function(e,r){r.normalize(e)});!function(e){return"[object String]"===s(e)}(t)?u(e,t):c.push(e)}})),c.forEach((function(e){r.__compiled__[r.__schemas__[e]]&&(r.__compiled__[e].validate=r.__compiled__[r.__schemas__[e]].validate,r.__compiled__[e].normalize=r.__compiled__[r.__schemas__[e]].normalize)})),r.__compiled__[""]={validate:null,normalize:function(e,r){r.normalize(e)}};var p=Object.keys(r.__compiled__).filter((function(e){return e.length>0&&r.__compiled__[e]})).map(i).join("|");r.re.schema_test=RegExp("(^|(?!_)(?:[><\uff5c]|"+t.src_ZPCc+"))("+p+")","i"),r.re.schema_search=RegExp("(^|(?!_)(?:[><\uff5c]|"+t.src_ZPCc+"))("+p+")","ig"),r.re.pretest=RegExp("("+r.re.schema_test.source+")|("+r.re.host_fuzzy_test.source+")|@","i"),function(e){e.__index__=-1,e.__text_cache__=""}(r)}function h(e,r){var t=e.__index__,n=e.__last_index__,s=e.__text_cache__.slice(t,n);this.schema=e.__schema__.toLowerCase(),this.index=t+r,this.lastIndex=n+r,this.raw=s,this.text=s,this.url=s}function f(e,r){var t=new h(e,r);return e.__compiled__[t.schema].normalize(t,e),t}function d(e,r){if(!(this instanceof d))return new d(e,r);var t;r||(t=e,Object.keys(t||{}).reduce((function(e,r){return e||a.hasOwnProperty(r)}),!1)&&(r=e,e={})),this.__opts__=n({},a,r),this.__index__=-1,this.__last_index__=-1,this.__schema__="",this.__text_cache__="",this.__schemas__=n({},c,e),this.__compiled__={},this.__tlds__=u,this.__tlds_replaced__=!1,this.re={},p(this)}d.prototype.add=function(e,r){return this.__schemas__[e]=r,p(this),this},d.prototype.set=function(e){return this.__opts__=n(this.__opts__,e),this},d.prototype.test=function(e){if(this.__text_cache__=e,this.__index__=-1,!e.length)return!1;var r,t,n,s,o,i,a,c;if(this.re.schema_test.test(e))for((a=this.re.schema_search).lastIndex=0;null!==(r=a.exec(e));)if(s=this.testSchemaAt(e,r[2],a.lastIndex)){this.__schema__=r[2],this.__index__=r.index+r[1].length,this.__last_index__=r.index+r[0].length+s;break}return this.__opts__.fuzzyLink&&this.__compiled__["http:"]&&(c=e.search(this.re.host_fuzzy_test))>=0&&(this.__index__<0||c<this.__index__)&&null!==(t=e.match(this.__opts__.fuzzyIP?this.re.link_fuzzy:this.re.link_no_ip_fuzzy))&&(o=t.index+t[1].length,(this.__index__<0||o<this.__index__)&&(this.__schema__="",this.__index__=o,this.__last_index__=t.index+t[0].length)),this.__opts__.fuzzyEmail&&this.__compiled__["mailto:"]&&e.indexOf("@")>=0&&null!==(n=e.match(this.re.email_fuzzy))&&(o=n.index+n[1].length,i=n.index+n[0].length,(this.__index__<0||o<this.__index__||o===this.__index__&&i>this.__last_index__)&&(this.__schema__="mailto:",this.__index__=o,this.__last_index__=i)),this.__index__>=0},d.prototype.pretest=function(e){return this.re.pretest.test(e)},d.prototype.testSchemaAt=function(e,r,t){return this.__compiled__[r.toLowerCase()]?this.__compiled__[r.toLowerCase()].validate(e,t,this):0},d.prototype.match=function(e){var r=0,t=[];this.__index__>=0&&this.__text_cache__===e&&(t.push(f(this,r)),r=this.__last_index__);for(var n=r?e.slice(r):e;this.test(n);)t.push(f(this,r)),n=n.slice(this.__last_index__),r+=this.__last_index__;return t.length?t:null},d.prototype.tlds=function(e,r){return e=Array.isArray(e)?e:[e],r?(this.__tlds__=this.__tlds__.concat(e).sort().filter((function(e,r,t){return e!==t[r-1]})).reverse(),p(this),this):(this.__tlds__=e.slice(),this.__tlds_replaced__=!0,p(this),this)},d.prototype.normalize=function(e){e.schema||(e.url="http://"+e.url),"mailto:"!==e.schema||/^mailto:/i.test(e.url)||(e.url="mailto:"+e.url)},d.prototype.onCompile=function(){},r.exports=d},{"./lib/re":54}],54:[function(e,r,t){"use strict";r.exports=function(r){var t={};t.src_Any=e("uc.micro/properties/Any/regex").source,t.src_Cc=e("uc.micro/categories/Cc/regex").source,t.src_Z=e("uc.micro/categories/Z/regex").source,t.src_P=e("uc.micro/categories/P/regex").source,t.src_ZPCc=[t.src_Z,t.src_P,t.src_Cc].join("|"),t.src_ZCc=[t.src_Z,t.src_Cc].join("|");return t.src_pseudo_letter="(?:(?![><\uff5c]|"+t.src_ZPCc+")"+t.src_Any+")",t.src_ip4="(?:(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)",t.src_auth="(?:(?:(?!"+t.src_ZCc+"|[@/\\[\\]()]).)+@)?",t.src_port="(?::(?:6(?:[0-4]\\d{3}|5(?:[0-4]\\d{2}|5(?:[0-2]\\d|3[0-5])))|[1-5]?\\d{1,4}))?",t.src_host_terminator="(?=$|[><\uff5c]|"+t.src_ZPCc+")(?!-|_|:\\d|\\.-|\\.(?!$|"+t.src_ZPCc+"))",t.src_path="(?:[/?#](?:(?!"+t.src_ZCc+"|[><\uff5c]|[()[\\]{}.,\"'?!\\-]).|\\[(?:(?!"+t.src_ZCc+"|\\]).)*\\]|\\((?:(?!"+t.src_ZCc+"|[)]).)*\\)|\\{(?:(?!"+t.src_ZCc+'|[}]).)*\\}|\\"(?:(?!'+t.src_ZCc+'|["]).)+\\"|\\\'(?:(?!'+t.src_ZCc+"|[']).)+\\'|\\'(?="+t.src_pseudo_letter+"|[-]).|\\.{2,4}[a-zA-Z0-9%/]|\\.(?!"+t.src_ZCc+"|[.]).|"+(r&&r["---"]?"\\-(?!--(?:[^-]|$))(?:-*)|":"\\-+|")+"\\,(?!"+t.src_ZCc+").|\\!(?!"+t.src_ZCc+"|[!]).|\\?(?!"+t.src_ZCc+"|[?]).)+|\\/)?",t.src_email_name='[\\-;:&=\\+\\$,\\.a-zA-Z0-9_][\\-;:&=\\+\\$,\\"\\.a-zA-Z0-9_]*',t.src_xn="xn--[a-z0-9\\-]{1,59}",t.src_domain_root="(?:"+t.src_xn+"|"+t.src_pseudo_letter+"{1,63})",t.src_domain="(?:"+t.src_xn+"|(?:"+t.src_pseudo_letter+")|(?:"+t.src_pseudo_letter+"(?:-|"+t.src_pseudo_letter+"){0,61}"+t.src_pseudo_letter+"))",t.src_host="(?:(?:(?:(?:"+t.src_domain+")\\.)*"+t.src_domain+"))",t.tpl_host_fuzzy="(?:"+t.src_ip4+"|(?:(?:(?:"+t.src_domain+")\\.)+(?:%TLDS%)))",t.tpl_host_no_ip_fuzzy="(?:(?:(?:"+t.src_domain+")\\.)+(?:%TLDS%))",t.src_host_strict=t.src_host+t.src_host_terminator,t.tpl_host_fuzzy_strict=t.tpl_host_fuzzy+t.src_host_terminator,t.src_host_port_strict=t.src_host+t.src_port+t.src_host_terminator,t.tpl_host_port_fuzzy_strict=t.tpl_host_fuzzy+t.src_port+t.src_host_terminator,t.tpl_host_port_no_ip_fuzzy_strict=t.tpl_host_no_ip_fuzzy+t.src_port+t.src_host_terminator,t.tpl_host_fuzzy_test="localhost|www\\.|\\.\\d{1,3}\\.|(?:\\.(?:%TLDS%)(?:"+t.src_ZPCc+"|>|$))",t.tpl_email_fuzzy='(^|[><\uff5c]|"|\\(|'+t.src_ZCc+")("+t.src_email_name+"@"+t.tpl_host_fuzzy_strict+")",t.tpl_link_fuzzy="(^|(?![.:/\\-_@])(?:[$+<=>^`|\uff5c]|"+t.src_ZPCc+"))((?![$+<=>^`|\uff5c])"+t.tpl_host_port_fuzzy_strict+t.src_path+")",t.tpl_link_no_ip_fuzzy="(^|(?![.:/\\-_@])(?:[$+<=>^`|\uff5c]|"+t.src_ZPCc+"))((?![$+<=>^`|\uff5c])"+t.tpl_host_port_no_ip_fuzzy_strict+t.src_path+")",t}},{"uc.micro/categories/Cc/regex":61,"uc.micro/categories/P/regex":63,"uc.micro/categories/Z/regex":64,"uc.micro/properties/Any/regex":66}],55:[function(e,r,t){"use strict";var n={};function s(e,r){var t;return"string"!=typeof r&&(r=s.defaultChars),t=function(e){var r,t,s=n[e];if(s)return s;for(s=n[e]=[],r=0;r<128;r++)t=String.fromCharCode(r),s.push(t);for(r=0;r<e.length;r++)s[t=e.charCodeAt(r)]="%"+("0"+t.toString(16).toUpperCase()).slice(-2);return s}(r),e.replace(/(%[a-f0-9]{2})+/gi,(function(e){var r,n,s,o,i,a,c,l="";for(r=0,n=e.length;r<n;r+=3)(s=parseInt(e.slice(r+1,r+3),16))<128?l+=t[s]:192==(224&s)&&r+3<n&&128==(192&(o=parseInt(e.slice(r+4,r+6),16)))?(l+=(c=s<<6&1984|63&o)<128?"\ufffd\ufffd":String.fromCharCode(c),r+=3):224==(240&s)&&r+6<n&&(o=parseInt(e.slice(r+4,r+6),16),i=parseInt(e.slice(r+7,r+9),16),128==(192&o)&&128==(192&i))?(l+=(c=s<<12&61440|o<<6&4032|63&i)<2048||c>=55296&&c<=57343?"\ufffd\ufffd\ufffd":String.fromCharCode(c),r+=6):240==(248&s)&&r+9<n&&(o=parseInt(e.slice(r+4,r+6),16),i=parseInt(e.slice(r+7,r+9),16),a=parseInt(e.slice(r+10,r+12),16),128==(192&o)&&128==(192&i)&&128==(192&a))?((c=s<<18&1835008|o<<12&258048|i<<6&4032|63&a)<65536||c>1114111?l+="\ufffd\ufffd\ufffd\ufffd":(c-=65536,l+=String.fromCharCode(55296+(c>>10),56320+(1023&c))),r+=9):l+="\ufffd";return l}))}s.defaultChars=";/?:@&=+$,#",s.componentChars="",r.exports=s},{}],56:[function(e,r,t){"use strict";var n={};function s(e,r,t){var o,i,a,c,l,u="";for("string"!=typeof r&&(t=r,r=s.defaultChars),void 0===t&&(t=!0),l=function(e){var r,t,s=n[e];if(s)return s;for(s=n[e]=[],r=0;r<128;r++)t=String.fromCharCode(r),/^[0-9a-z]$/i.test(t)?s.push(t):s.push("%"+("0"+r.toString(16).toUpperCase()).slice(-2));for(r=0;r<e.length;r++)s[e.charCodeAt(r)]=e[r];return s}(r),o=0,i=e.length;o<i;o++)if(a=e.charCodeAt(o),t&&37===a&&o+2<i&&/^[0-9a-f]{2}$/i.test(e.slice(o+1,o+3)))u+=e.slice(o,o+3),o+=2;else if(a<128)u+=l[a];else if(a>=55296&&a<=57343){if(a>=55296&&a<=56319&&o+1<i&&(c=e.charCodeAt(o+1))>=56320&&c<=57343){u+=encodeURIComponent(e[o]+e[o+1]),o++;continue}u+="%EF%BF%BD"}else u+=encodeURIComponent(e[o]);return u}s.defaultChars=";/?:@&=+$,-_.!~*'()#",s.componentChars="-_.!~*'()",r.exports=s},{}],57:[function(e,r,t){"use strict";r.exports=function(e){var r="";return r+=e.protocol||"",r+=e.slashes?"//":"",r+=e.auth?e.auth+"@":"",e.hostname&&-1!==e.hostname.indexOf(":")?r+="["+e.hostname+"]":r+=e.hostname||"",r+=e.port?":"+e.port:"",r+=e.pathname||"",r+=e.search||"",r+=e.hash||""}},{}],58:[function(e,r,t){"use strict";r.exports.encode=e("./encode"),r.exports.decode=e("./decode"),r.exports.format=e("./format"),r.exports.parse=e("./parse")},{"./decode":55,"./encode":56,"./format":57,"./parse":59}],59:[function(e,r,t){"use strict";function n(){this.protocol=null,this.slashes=null,this.auth=null,this.port=null,this.hostname=null,this.hash=null,this.search=null,this.pathname=null}var s=/^([a-z0-9.+-]+:)/i,o=/:[0-9]*$/,i=/^(\/\/?(?!\/)[^\?\s]*)(\?[^\s]*)?$/,a=["{","}","|","\\","^","`"].concat(["<",">",'"',"`"," ","\r","\n","\t"]),c=["'"].concat(a),l=["%","/","?",";","#"].concat(c),u=["/","?","#"],p=/^[+a-z0-9A-Z_-]{0,63}$/,h=/^([+a-z0-9A-Z_-]{0,63})(.*)$/,f={javascript:!0,"javascript:":!0},d={http:!0,https:!0,ftp:!0,gopher:!0,file:!0,"http:":!0,"https:":!0,"ftp:":!0,"gopher:":!0,"file:":!0};n.prototype.parse=function(e,r){var t,n,o,a,c,m=e;if(m=m.trim(),!r&&1===e.split("#").length){var _=i.exec(m);if(_)return this.pathname=_[1],_[2]&&(this.search=_[2]),this}var g=s.exec(m);if(g&&(o=(g=g[0]).toLowerCase(),this.protocol=g,m=m.substr(g.length)),(r||g||m.match(/^\/\/[^@\/]+@[^@\/]+/))&&(!(c="//"===m.substr(0,2))||g&&f[g]||(m=m.substr(2),this.slashes=!0)),!f[g]&&(c||g&&!d[g])){var k,b,v=-1;for(t=0;t<u.length;t++)-1!==(a=m.indexOf(u[t]))&&(-1===v||a<v)&&(v=a);for(-1!==(b=-1===v?m.lastIndexOf("@"):m.lastIndexOf("@",v))&&(k=m.slice(0,b),m=m.slice(b+1),this.auth=k),v=-1,t=0;t<l.length;t++)-1!==(a=m.indexOf(l[t]))&&(-1===v||a<v)&&(v=a);-1===v&&(v=m.length),":"===m[v-1]&&v--;var y=m.slice(0,v);m=m.slice(v),this.parseHost(y),this.hostname=this.hostname||"";var C="["===this.hostname[0]&&"]"===this.hostname[this.hostname.length-1];if(!C){var x=this.hostname.split(/\./);for(t=0,n=x.length;t<n;t++){var A=x[t];if(A&&!A.match(p)){for(var w="",D=0,E=A.length;D<E;D++)A.charCodeAt(D)>127?w+="x":w+=A[D];if(!w.match(p)){var q=x.slice(0,t),F=x.slice(t+1),S=A.match(h);S&&(q.push(S[1]),F.unshift(S[2])),F.length&&(m=F.join(".")+m),this.hostname=q.join(".");break}}}}this.hostname.length>255&&(this.hostname=""),C&&(this.hostname=this.hostname.substr(1,this.hostname.length-2))}var L=m.indexOf("#");-1!==L&&(this.hash=m.substr(L),m=m.slice(0,L));var z=m.indexOf("?");return-1!==z&&(this.search=m.substr(z),m=m.slice(0,z)),m&&(this.pathname=m),d[o]&&this.hostname&&!this.pathname&&(this.pathname=""),this},n.prototype.parseHost=function(e){var r=o.exec(e);r&&(":"!==(r=r[0])&&(this.port=r.substr(1)),e=e.substr(0,e.length-r.length)),e&&(this.hostname=e)},r.exports=function(e,r){if(e&&e instanceof n)return e;var t=new n;return t.parse(e,r),t}},{}],60:[function(e,r,t){(function(e){!function(n){var s="object"==typeof t&&t&&!t.nodeType&&t,o="object"==typeof r&&r&&!r.nodeType&&r,i="object"==typeof e&&e;i.global!==i&&i.window!==i&&i.self!==i||(n=i);var a,c,l=2147483647,u=36,p=1,h=26,f=38,d=700,m=72,_=128,g="-",k=/^xn--/,b=/[^\x20-\x7E]/,v=/[\x2E\u3002\uFF0E\uFF61]/g,y={overflow:"Overflow: input needs wider integers to process","not-basic":"Illegal input >= 0x80 (not a basic code point)","invalid-input":"Invalid input"},C=u-p,x=Math.floor,A=String.fromCharCode;function w(e){throw new RangeError(y[e])}function D(e,r){for(var t=e.length,n=[];t--;)n[t]=r(e[t]);return n}function E(e,r){var t=e.split("@"),n="";return t.length>1&&(n=t[0]+"@",e=t[1]),n+D((e=e.replace(v,".")).split("."),r).join(".")}function q(e){for(var r,t,n=[],s=0,o=e.length;s<o;)(r=e.charCodeAt(s++))>=55296&&r<=56319&&s<o?56320==(64512&(t=e.charCodeAt(s++)))?n.push(((1023&r)<<10)+(1023&t)+65536):(n.push(r),s--):n.push(r);return n}function F(e){return D(e,(function(e){var r="";return e>65535&&(r+=A((e-=65536)>>>10&1023|55296),e=56320|1023&e),r+=A(e)})).join("")}function S(e,r){return e+22+75*(e<26)-((0!=r)<<5)}function L(e,r,t){var n=0;for(e=t?x(e/d):e>>1,e+=x(e/r);e>C*h>>1;n+=u)e=x(e/C);return x(n+(C+1)*e/(e+f))}function z(e){var r,t,n,s,o,i,a,c,f,d,k,b=[],v=e.length,y=0,C=_,A=m;for((t=e.lastIndexOf(g))<0&&(t=0),n=0;n<t;++n)e.charCodeAt(n)>=128&&w("not-basic"),b.push(e.charCodeAt(n));for(s=t>0?t+1:0;s<v;){for(o=y,i=1,a=u;s>=v&&w("invalid-input"),((c=(k=e.charCodeAt(s++))-48<10?k-22:k-65<26?k-65:k-97<26?k-97:u)>=u||c>x((l-y)/i))&&w("overflow"),y+=c*i,!(c<(f=a<=A?p:a>=A+h?h:a-A));a+=u)i>x(l/(d=u-f))&&w("overflow"),i*=d;A=L(y-o,r=b.length+1,0==o),x(y/r)>l-C&&w("overflow"),C+=x(y/r),y%=r,b.splice(y++,0,C)}return F(b)}function T(e){var r,t,n,s,o,i,a,c,f,d,k,b,v,y,C,D=[];for(b=(e=q(e)).length,r=_,t=0,o=m,i=0;i<b;++i)(k=e[i])<128&&D.push(A(k));for(n=s=D.length,s&&D.push(g);n<b;){for(a=l,i=0;i<b;++i)(k=e[i])>=r&&k<a&&(a=k);for(a-r>x((l-t)/(v=n+1))&&w("overflow"),t+=(a-r)*v,r=a,i=0;i<b;++i)if((k=e[i])<r&&++t>l&&w("overflow"),k==r){for(c=t,f=u;!(c<(d=f<=o?p:f>=o+h?h:f-o));f+=u)C=c-d,y=u-d,D.push(A(S(d+C%y,0))),c=x(C/y);D.push(A(S(c,0))),o=L(t,v,n==s),t=0,++n}++t,++r}return D.join("")}if(a={version:"1.4.1",ucs2:{decode:q,encode:F},decode:z,encode:T,toASCII:function(e){return E(e,(function(e){return b.test(e)?"xn--"+T(e):e}))},toUnicode:function(e){return E(e,(function(e){return k.test(e)?z(e.slice(4).toLowerCase()):e}))}},s&&o)if(r.exports==s)o.exports=a;else for(c in a)a.hasOwnProperty(c)&&(s[c]=a[c]);else n.punycode=a}(this)}).call(this,"undefined"!=typeof global?global:"undefined"!=typeof self?self:"undefined"!=typeof window?window:{})},{}],61:[function(e,r,t){r.exports=/[\0-\x1F\x7F-\x9F]/},{}],62:[function(e,r,t){r.exports=/[\xAD\u0600-\u0605\u061C\u06DD\u070F\u08E2\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF\uFFF9-\uFFFB]|\uD804[\uDCBD\uDCCD]|\uD82F[\uDCA0-\uDCA3]|\uD834[\uDD73-\uDD7A]|\uDB40[\uDC01\uDC20-\uDC7F]/},{}],63:[function(e,r,t){r.exports=/[!-#%-\*,-\/:;\?@\[-\]_\{\}\xA1\xA7\xAB\xB6\xB7\xBB\xBF\u037E\u0387\u055A-\u055F\u0589\u058A\u05BE\u05C0\u05C3\u05C6\u05F3\u05F4\u0609\u060A\u060C\u060D\u061B\u061E\u061F\u066A-\u066D\u06D4\u0700-\u070D\u07F7-\u07F9\u0830-\u083E\u085E\u0964\u0965\u0970\u09FD\u0A76\u0AF0\u0C84\u0DF4\u0E4F\u0E5A\u0E5B\u0F04-\u0F12\u0F14\u0F3A-\u0F3D\u0F85\u0FD0-\u0FD4\u0FD9\u0FDA\u104A-\u104F\u10FB\u1360-\u1368\u1400\u166D\u166E\u169B\u169C\u16EB-\u16ED\u1735\u1736\u17D4-\u17D6\u17D8-\u17DA\u1800-\u180A\u1944\u1945\u1A1E\u1A1F\u1AA0-\u1AA6\u1AA8-\u1AAD\u1B5A-\u1B60\u1BFC-\u1BFF\u1C3B-\u1C3F\u1C7E\u1C7F\u1CC0-\u1CC7\u1CD3\u2010-\u2027\u2030-\u2043\u2045-\u2051\u2053-\u205E\u207D\u207E\u208D\u208E\u2308-\u230B\u2329\u232A\u2768-\u2775\u27C5\u27C6\u27E6-\u27EF\u2983-\u2998\u29D8-\u29DB\u29FC\u29FD\u2CF9-\u2CFC\u2CFE\u2CFF\u2D70\u2E00-\u2E2E\u2E30-\u2E4E\u3001-\u3003\u3008-\u3011\u3014-\u301F\u3030\u303D\u30A0\u30FB\uA4FE\uA4FF\uA60D-\uA60F\uA673\uA67E\uA6F2-\uA6F7\uA874-\uA877\uA8CE\uA8CF\uA8F8-\uA8FA\uA8FC\uA92E\uA92F\uA95F\uA9C1-\uA9CD\uA9DE\uA9DF\uAA5C-\uAA5F\uAADE\uAADF\uAAF0\uAAF1\uABEB\uFD3E\uFD3F\uFE10-\uFE19\uFE30-\uFE52\uFE54-\uFE61\uFE63\uFE68\uFE6A\uFE6B\uFF01-\uFF03\uFF05-\uFF0A\uFF0C-\uFF0F\uFF1A\uFF1B\uFF1F\uFF20\uFF3B-\uFF3D\uFF3F\uFF5B\uFF5D\uFF5F-\uFF65]|\uD800[\uDD00-\uDD02\uDF9F\uDFD0]|\uD801\uDD6F|\uD802[\uDC57\uDD1F\uDD3F\uDE50-\uDE58\uDE7F\uDEF0-\uDEF6\uDF39-\uDF3F\uDF99-\uDF9C]|\uD803[\uDF55-\uDF59]|\uD804[\uDC47-\uDC4D\uDCBB\uDCBC\uDCBE-\uDCC1\uDD40-\uDD43\uDD74\uDD75\uDDC5-\uDDC8\uDDCD\uDDDB\uDDDD-\uDDDF\uDE38-\uDE3D\uDEA9]|\uD805[\uDC4B-\uDC4F\uDC5B\uDC5D\uDCC6\uDDC1-\uDDD7\uDE41-\uDE43\uDE60-\uDE6C\uDF3C-\uDF3E]|\uD806[\uDC3B\uDE3F-\uDE46\uDE9A-\uDE9C\uDE9E-\uDEA2]|\uD807[\uDC41-\uDC45\uDC70\uDC71\uDEF7\uDEF8]|\uD809[\uDC70-\uDC74]|\uD81A[\uDE6E\uDE6F\uDEF5\uDF37-\uDF3B\uDF44]|\uD81B[\uDE97-\uDE9A]|\uD82F\uDC9F|\uD836[\uDE87-\uDE8B]|\uD83A[\uDD5E\uDD5F]/},{}],64:[function(e,r,t){r.exports=/[ \xA0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/},{}],65:[function(e,r,t){"use strict";t.Any=e("./properties/Any/regex"),t.Cc=e("./categories/Cc/regex"),t.Cf=e("./categories/Cf/regex"),t.P=e("./categories/P/regex"),t.Z=e("./categories/Z/regex")},{"./categories/Cc/regex":61,"./categories/Cf/regex":62,"./categories/P/regex":63,"./categories/Z/regex":64,"./properties/Any/regex":66}],66:[function(e,r,t){r.exports=/[\0-\uD7FF\uE000-\uFFFF]|[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/},{}],67:[function(e,r,t){"use strict";r.exports=e("./lib/")},{"./lib/":9}]},{},[67])(67)}));
;/*! markdown-it-sub 1.0.0 https://github.com//markdown-it/markdown-it-sub @license MIT */
!function(e){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=e();else if("function"==typeof define&&define.amd)define([],e);else{var r;r="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof self?self:this,r.markdownitSub=e()}}(function(){return function e(r,o,n){function t(i,u){if(!o[i]){if(!r[i]){var f="function"==typeof require&&require;if(!u&&f)return f(i,!0);if(s)return s(i,!0);var p=new Error("Cannot find module '"+i+"'");throw p.code="MODULE_NOT_FOUND",p}var a=o[i]={exports:{}};r[i][0].call(a.exports,function(e){var o=r[i][1][e];return t(o?o:e)},a,a.exports,e,r,o,n)}return o[i].exports}for(var s="function"==typeof require&&require,i=0;i<n.length;i++)t(n[i]);return t}({1:[function(e,r){"use strict";function o(e,r){var o,t,s,i=e.posMax,u=e.pos;if(126!==e.src.charCodeAt(u))return!1;if(r)return!1;if(u+2>=i)return!1;for(e.pos=u+1;e.pos<i;){if(126===e.src.charCodeAt(e.pos)){o=!0;break}e.md.inline.skipToken(e)}return o&&u+1!==e.pos?(t=e.src.slice(u+1,e.pos),t.match(/(^|[^\\])(\\\\)*\s/)?(e.pos=u,!1):(e.posMax=e.pos,e.pos=u+1,s=e.push("sub_open","sub",1),s.markup="~",s=e.push("text","",0),s.content=t.replace(n,"$1"),s=e.push("sub_close","sub",-1),s.markup="~",e.pos=e.posMax+1,e.posMax=i,!0)):(e.pos=u,!1)}var n=/\\([ \\!"#$%&'()*+,.\/:;<=>?@[\]^_`{|}~-])/g;r.exports=function(e){e.inline.ruler.after("emphasis","sub",o)}},{}]},{},[1])(1)});;/*! markdown-it-sup 1.0.0 https://github.com//markdown-it/markdown-it-sup @license MIT */
!function(e){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=e();else if("function"==typeof define&&define.amd)define([],e);else{var r;r="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof self?self:this,r.markdownitSup=e()}}(function(){return function e(r,o,n){function t(i,p){if(!o[i]){if(!r[i]){var u="function"==typeof require&&require;if(!p&&u)return u(i,!0);if(s)return s(i,!0);var f=new Error("Cannot find module '"+i+"'");throw f.code="MODULE_NOT_FOUND",f}var a=o[i]={exports:{}};r[i][0].call(a.exports,function(e){var o=r[i][1][e];return t(o?o:e)},a,a.exports,e,r,o,n)}return o[i].exports}for(var s="function"==typeof require&&require,i=0;i<n.length;i++)t(n[i]);return t}({1:[function(e,r){"use strict";function o(e,r){var o,t,s,i=e.posMax,p=e.pos;if(94!==e.src.charCodeAt(p))return!1;if(r)return!1;if(p+2>=i)return!1;for(e.pos=p+1;e.pos<i;){if(94===e.src.charCodeAt(e.pos)){o=!0;break}e.md.inline.skipToken(e)}return o&&p+1!==e.pos?(t=e.src.slice(p+1,e.pos),t.match(/(^|[^\\])(\\\\)*\s/)?(e.pos=p,!1):(e.posMax=e.pos,e.pos=p+1,s=e.push("sup_open","sup",1),s.markup="^",s=e.push("text","",0),s.content=t.replace(n,"$1"),s=e.push("sup_close","sup",-1),s.markup="^",e.pos=e.posMax+1,e.posMax=i,!0)):(e.pos=p,!1)}var n=/\\([ \\!"#$%&'()*+,.\/:;<=>?@[\]^_`{|}~-])/g;r.exports=function(e){e.inline.ruler.after("emphasis","sup",o)}},{}]},{},[1])(1)});;!function(e){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=e();else if("function"==typeof define&&define.amd)define([],e);else{("undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof self?self:this).markdownitFootnote=e()}}(function(){return function(){return function e(o,t,n){function r(f,l){if(!t[f]){if(!o[f]){var i="function"==typeof require&&require;if(!l&&i)return i(f,!0);if(s)return s(f,!0);var u=new Error("Cannot find module '"+f+"'");throw u.code="MODULE_NOT_FOUND",u}var a=t[f]={exports:{}};o[f][0].call(a.exports,function(e){return r(o[f][1][e]||e)},a,a.exports,e,o,t,n)}return t[f].exports}for(var s="function"==typeof require&&require,f=0;f<n.length;f++)r(n[f]);return r}}()({1:[function(e,o,t){"use strict";function n(e,o,t,n){var r=Number(e[o].meta.id+1).toString(),s="";return"string"==typeof n.docId&&(s="-"+n.docId+"-"),s+r}function r(e,o){var t=Number(e[o].meta.id+1).toString();return e[o].meta.subId>0&&(t+=":"+e[o].meta.subId),"["+t+"]"}function s(e,o,t,n,r){var s=r.rules.footnote_anchor_name(e,o,t,n,r),f=r.rules.footnote_caption(e,o,t,n,r),l=s;return e[o].meta.subId>0&&(l+=":"+e[o].meta.subId),'<sup class="footnote-ref"><a href="#fn'+s+'" id="fnref'+l+'">'+f+"</a></sup>"}function f(e,o,t){return(t.xhtmlOut?'<hr class="footnotes-sep" />\n':'<hr class="footnotes-sep">\n')+'<section class="footnotes">\n<ol class="footnotes-list">\n'}function l(){return"</ol>\n</section>\n"}function i(e,o,t,n,r){var s=r.rules.footnote_anchor_name(e,o,t,n,r);return e[o].meta.subId>0&&(s+=":"+e[o].meta.subId),'<li id="fn'+s+'" class="footnote-item">'}function u(){return"</li>\n"}function a(e,o,t,n,r){var s=r.rules.footnote_anchor_name(e,o,t,n,r);return e[o].meta.subId>0&&(s+=":"+e[o].meta.subId),' <a href="#fnref'+s+'" class="footnote-backref">\u21a9\ufe0e</a>'}o.exports=function(e){var o=e.helpers.parseLinkLabel,t=e.utils.isSpace;e.renderer.rules.footnote_ref=s,e.renderer.rules.footnote_block_open=f,e.renderer.rules.footnote_block_close=l,e.renderer.rules.footnote_open=i,e.renderer.rules.footnote_close=u,e.renderer.rules.footnote_anchor=a,e.renderer.rules.footnote_caption=r,e.renderer.rules.footnote_anchor_name=n,e.block.ruler.before("reference","footnote_def",function(e,o,n,r){var s,f,l,i,u,a,c,p,d,h,k,b=e.bMarks[o]+e.tShift[o],v=e.eMarks[o];if(b+4>v)return!1;if(91!==e.src.charCodeAt(b))return!1;if(94!==e.src.charCodeAt(b+1))return!1;for(u=b+2;u<v;u++){if(32===e.src.charCodeAt(u))return!1;if(93===e.src.charCodeAt(u))break}if(u===b+2)return!1;if(u+1>=v||58!==e.src.charCodeAt(++u))return!1;if(r)return!0;for(u++,e.env.footnotes||(e.env.footnotes={}),e.env.footnotes.refs||(e.env.footnotes.refs={}),a=e.src.slice(b+2,u-2),e.env.footnotes.refs[":"+a]=-1,(c=new e.Token("footnote_reference_open","",1)).meta={label:a},c.level=e.level++,e.tokens.push(c),s=e.bMarks[o],f=e.tShift[o],l=e.sCount[o],i=e.parentType,k=u,p=d=e.sCount[o]+u-(e.bMarks[o]+e.tShift[o]);u<v&&(h=e.src.charCodeAt(u),t(h));)9===h?d+=4-d%4:d++,u++;return e.tShift[o]=u-k,e.sCount[o]=d-p,e.bMarks[o]=k,e.blkIndent+=4,e.parentType="footnote",e.sCount[o]<e.blkIndent&&(e.sCount[o]+=e.blkIndent),e.md.block.tokenize(e,o,n,!0),e.parentType=i,e.blkIndent-=4,e.tShift[o]=f,e.sCount[o]=l,e.bMarks[o]=s,(c=new e.Token("footnote_reference_close","",-1)).level=--e.level,e.tokens.push(c),!0},{alt:["paragraph","reference"]}),e.inline.ruler.after("image","footnote_inline",function(e,t){var n,r,s,f,l=e.posMax,i=e.pos;return!(i+2>=l||94!==e.src.charCodeAt(i)||91!==e.src.charCodeAt(i+1)||(n=i+2,(r=o(e,i+1))<0||(t||(e.env.footnotes||(e.env.footnotes={}),e.env.footnotes.list||(e.env.footnotes.list=[]),s=e.env.footnotes.list.length,e.md.inline.parse(e.src.slice(n,r),e.md,e.env,f=[]),e.push("footnote_ref","",0).meta={id:s},e.env.footnotes.list[s]={content:e.src.slice(n,r),tokens:f}),e.pos=r+1,e.posMax=l,0)))}),e.inline.ruler.after("footnote_inline","footnote_ref",function(e,o){var t,n,r,s,f=e.posMax,l=e.pos;if(l+3>f)return!1;if(!e.env.footnotes||!e.env.footnotes.refs)return!1;if(91!==e.src.charCodeAt(l))return!1;if(94!==e.src.charCodeAt(l+1))return!1;for(n=l+2;n<f;n++){if(32===e.src.charCodeAt(n))return!1;if(10===e.src.charCodeAt(n))return!1;if(93===e.src.charCodeAt(n))break}return!(n===l+2||n>=f||(n++,t=e.src.slice(l+2,n-1),void 0===e.env.footnotes.refs[":"+t]||(o||(e.env.footnotes.list||(e.env.footnotes.list=[]),e.env.footnotes.refs[":"+t]<0?(r=e.env.footnotes.list.length,e.env.footnotes.list[r]={label:t,count:0},e.env.footnotes.refs[":"+t]=r):r=e.env.footnotes.refs[":"+t],s=e.env.footnotes.list[r].count,e.env.footnotes.list[r].count++,e.push("footnote_ref","",0).meta={id:r,subId:s,label:t}),e.pos=n,e.posMax=f,0)))}),e.core.ruler.after("inline","footnote_tail",function(e){var o,t,n,r,s,f,l,i,u,a,c=!1,p={};if(e.env.footnotes&&(e.tokens=e.tokens.filter(function(e){return"footnote_reference_open"===e.type?(c=!0,u=[],a=e.meta.label,!1):"footnote_reference_close"===e.type?(c=!1,p[":"+a]=u,!1):(c&&u.push(e),!c)}),e.env.footnotes.list)){for(f=e.env.footnotes.list,l=new e.Token("footnote_block_open","",1),e.tokens.push(l),o=0,t=f.length;o<t;o++){for((l=new e.Token("footnote_open","",1)).meta={id:o,label:f[o].label},e.tokens.push(l),f[o].tokens?(i=[],(l=new e.Token("paragraph_open","p",1)).block=!0,i.push(l),(l=new e.Token("inline","",0)).children=f[o].tokens,l.content=f[o].content,i.push(l),(l=new e.Token("paragraph_close","p",-1)).block=!0,i.push(l)):f[o].label&&(i=p[":"+f[o].label]),e.tokens=e.tokens.concat(i),s="paragraph_close"===e.tokens[e.tokens.length-1].type?e.tokens.pop():null,r=f[o].count>0?f[o].count:1,n=0;n<r;n++)(l=new e.Token("footnote_anchor","",0)).meta={id:o,subId:n,label:f[o].label},e.tokens.push(l);s&&e.tokens.push(s),l=new e.Token("footnote_close","",-1),e.tokens.push(l)}l=new e.Token("footnote_block_close","",-1),e.tokens.push(l)}})}},{}]},{},[1])(1)});
;/*! markdown-it-task-lists 2.1.0 https://github.com/revin/markdown-it-task-lists#readme by  @license {ISC} */
!function(n){if("object"==typeof exports&&"undefined"!=typeof module)module.exports=n();else if("function"==typeof define&&define.amd)define([],n);else{var e;e="undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof self?self:this,e.markdownitTaskLists=n()}}(function(){return function(){function n(e,t,i){function r(c,l){if(!t[c]){if(!e[c]){var f="function"==typeof require&&require;if(!l&&f)return f(c,!0);if(o)return o(c,!0);var u=new Error("Cannot find module '"+c+"'");throw u.code="MODULE_NOT_FOUND",u}var a=t[c]={exports:{}};e[c][0].call(a.exports,function(n){var t=e[c][1][n];return r(t?t:n)},a,a.exports,n,e,t,i)}return t[c].exports}for(var o="function"==typeof require&&require,c=0;c<i.length;c++)r(i[c]);return r}return n}()({1:[function(n,e,t){function i(n,e,t){var i=n.attrIndex(e),r=[e,t];0>i?n.attrPush(r):n.attrs[i]=r}function r(n,e){for(var t=n[e].level-1,i=e-1;i>=0;i--)if(n[i].level===t)return i;return-1}function o(n,e){return s(n[e])&&d(n[e-1])&&h(n[e-2])&&p(n[e])}function c(n,e){if(n.children.unshift(l(n,e)),n.children[1].content=n.children[1].content.slice(3),n.content=n.content.slice(3),b)if(v){n.children.pop();var t="task-item-"+Math.ceil(1e7*Math.random()-1e3);n.children[0].content=n.children[0].content.slice(0,-1)+' id="'+t+'">',n.children.push(a(n.content,t,e))}else n.children.unshift(f(e)),n.children.push(u(e))}function l(n,e){var t=new e("html_inline","",0),i=x?' disabled="" ':"";return 0===n.content.indexOf("[ ] ")?t.content='<input class="task-list-item-checkbox"'+i+'type="checkbox">':(0===n.content.indexOf("[x] ")||0===n.content.indexOf("[X] "))&&(t.content='<input class="task-list-item-checkbox" checked=""'+i+'type="checkbox">'),t}function f(n){var e=new n("html_inline","",0);return e.content="<label>",e}function u(n){var e=new n("html_inline","",0);return e.content="</label>",e}function a(n,e,t){var i=new t("html_inline","",0);return i.content='<label class="task-list-item-label" for="'+e+'">'+n+"</label>",i.attrs=[{"for":e}],i}function s(n){return"inline"===n.type}function d(n){return"paragraph_open"===n.type}function h(n){return"list_item_open"===n.type}function p(n){return 0===n.content.indexOf("[ ] ")||0===n.content.indexOf("[x] ")||0===n.content.indexOf("[X] ")}var x=!0,b=!1,v=!1;e.exports=function(n,e){e&&(x=!e.enabled,b=!!e.label,v=!!e.labelAfter),n.core.ruler.after("inline","github-task-lists",function(n){for(var e=n.tokens,t=2;t<e.length;t++)o(e,t)&&(c(e[t],n.Token),i(e[t-2],"class","task-list-item"+(x?"":" enabled")),i(e[r(e,t-2)],"class","contains-task-list"))})}},{}]},{},[1])(1)});
;"use strict";

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }

var ComponentManager =
/*#__PURE__*/
function () {
  function ComponentManager(permissions, onReady) {
    _classCallCheck(this, ComponentManager);

    this.sentMessages = [];
    this.messageQueue = [];
    this.loggingEnabled = false;
    this.acceptsThemes = true;
    this.activeThemes = [];
    this.initialPermissions = permissions;
    this.onReadyCallback = onReady;
    this.coallesedSaving = true;
    this.coallesedSavingDelay = 250;
    this.registerMessageHandler();
  }

  _createClass(ComponentManager, [{
    key: "registerMessageHandler",
    value: function registerMessageHandler() {
      var _this = this;

      var messageHandler = function messageHandler(event) {
        if (_this.loggingEnabled) {
          console.log("Components API Message received:", event.data);
        } // We don't have access to window.parent.origin due to cross-domain restrictions.
        // Check referrer if available, otherwise defer to checking for first-run value.
        // Craft URL objects so that example.com === example.com/


        if (document.referrer) {
          var referrer = new URL(document.referrer).origin;
          var eventOrigin = new URL(event.origin).origin;

          if (referrer !== eventOrigin) {
            return;
          }
        } // The first message will be the most reliable one, so we won't change it after any subsequent events,
        // in case you receive an event from another window.


        if (!_this.origin) {
          _this.origin = event.origin;
        } else if (event.origin !== _this.origin) {
          // If event origin doesn't match first-run value, return.
          return;
        } // Mobile environment sends data as JSON string


        var data = event.data;
        var parsedData = typeof data === "string" ? JSON.parse(data) : data;

        _this.handleMessage(parsedData);
      };
      /*
        Mobile (React Native) uses `document`, web/desktop uses `window`.addEventListener
        for postMessage API to work properly.
         Update May 2019:
        As part of transitioning React Native webview into the community package,
        we'll now only need to use window.addEventListener.
         However, we want to maintain backward compatibility for Mobile < v3.0.5, so we'll keep document.addEventListener
         Also, even with the new version of react-native-webview, Android may still require document.addEventListener (while iOS still only requires window.addEventListener)
        https://github.com/react-native-community/react-native-webview/issues/323#issuecomment-467767933
       */


      document.addEventListener("message", function (event) {
        messageHandler(event);
      }, false);
      window.addEventListener("message", function (event) {
        messageHandler(event);
      }, false);
    }
  }, {
    key: "handleMessage",
    value: function handleMessage(payload) {
      if (payload.action === "component-registered") {
        this.sessionKey = payload.sessionKey;
        this.componentData = payload.componentData;
        this.onReady(payload.data);

        if (this.loggingEnabled) {
          console.log("Component successfully registered with payload:", payload);
        }
      } else if (payload.action === "themes") {
        if (this.acceptsThemes) {
          this.activateThemes(payload.data.themes);
        }
      } else if (payload.original) {
        // get callback from queue
        var originalMessage = this.sentMessages.filter(function (message) {
          return message.messageId === payload.original.messageId;
        })[0];

        if (!originalMessage) {
          // Connection must have been reset. Alert the user.
          alert("This extension is attempting to communicate with Standard Notes, but an error is preventing it from doing so. Please restart this extension and try again.");
        }

        if (originalMessage.callback) {
          originalMessage.callback(payload.data);
        }
      }
    }
  }, {
    key: "onReady",
    value: function onReady(data) {
      this.environment = data.environment;
      this.platform = data.platform;
      this.uuid = data.uuid;
      this.isMobile = this.environment == "mobile";

      if (this.initialPermissions && this.initialPermissions.length > 0) {
        this.requestPermissions(this.initialPermissions);
      }

      var _iteratorNormalCompletion = true;
      var _didIteratorError = false;
      var _iteratorError = undefined;

      try {
        for (var _iterator = this.messageQueue[Symbol.iterator](), _step; !(_iteratorNormalCompletion = (_step = _iterator.next()).done); _iteratorNormalCompletion = true) {
          var message = _step.value;
          this.postMessage(message.action, message.data, message.callback);
        }
      } catch (err) {
        _didIteratorError = true;
        _iteratorError = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion && _iterator["return"] != null) {
            _iterator["return"]();
          }
        } finally {
          if (_didIteratorError) {
            throw _iteratorError;
          }
        }
      }

      this.messageQueue = [];

      if (this.loggingEnabled) {
        console.log("onReadyData", data);
      }

      this.activateThemes(data.activeThemeUrls || []);

      if (this.onReadyCallback) {
        this.onReadyCallback();
      }
    }
  }, {
    key: "getSelfComponentUUID",
    value: function getSelfComponentUUID() {
      return this.uuid;
    }
  }, {
    key: "isRunningInDesktopApplication",
    value: function isRunningInDesktopApplication() {
      return this.environment === "desktop";
    }
  }, {
    key: "setComponentDataValueForKey",
    value: function setComponentDataValueForKey(key, value) {
      this.componentData[key] = value;
      this.postMessage("set-component-data", {
        componentData: this.componentData
      }, function (data) {});
    }
  }, {
    key: "clearComponentData",
    value: function clearComponentData() {
      this.componentData = {};
      this.postMessage("set-component-data", {
        componentData: this.componentData
      }, function (data) {});
    }
  }, {
    key: "componentDataValueForKey",
    value: function componentDataValueForKey(key) {
      return this.componentData[key];
    }
  }, {
    key: "postMessage",
    value: function postMessage(action, data, callback) {
      if (!this.sessionKey) {
        this.messageQueue.push({
          action: action,
          data: data,
          callback: callback
        });
        return;
      }

      var message = {
        action: action,
        data: data,
        messageId: this.generateUUID(),
        sessionKey: this.sessionKey,
        api: "component"
      };
      var sentMessage = JSON.parse(JSON.stringify(message));
      sentMessage.callback = callback;
      this.sentMessages.push(sentMessage); // Mobile (React Native) requires a string for the postMessage API.

      if (this.isMobile) {
        message = JSON.stringify(message);
      }

      if (this.loggingEnabled) {
        console.log("Posting message:", message);
      }

      window.parent.postMessage(message, this.origin);
    }
  }, {
    key: "setSize",
    value: function setSize(type, width, height) {
      this.postMessage("set-size", {
        type: type,
        width: width,
        height: height
      }, function (data) {});
    }
  }, {
    key: "requestPermissions",
    value: function requestPermissions(permissions, callback) {
      this.postMessage("request-permissions", {
        permissions: permissions
      }, function (data) {
        callback && callback();
      }.bind(this));
    }
  }, {
    key: "streamItems",
    value: function streamItems(contentTypes, callback) {
      if (!Array.isArray(contentTypes)) {
        contentTypes = [contentTypes];
      }

      this.postMessage("stream-items", {
        content_types: contentTypes
      }, function (data) {
        callback(data.items);
      }.bind(this));
    }
  }, {
    key: "streamContextItem",
    value: function streamContextItem(callback) {
      var _this2 = this;

      this.postMessage("stream-context-item", null, function (data) {
        var item = data.item;
        /*
          If this is a new context item than the context item the component was currently entertaining,
          we want to immediately commit any pending saves, because if you send the new context item to the
          component before it has commited its presave, it will end up first replacing the UI with new context item,
          and when the debouncer executes to read the component UI, it will be reading the new UI for the previous item.
        */

        var isNewItem = !_this2.lastStreamedItem || _this2.lastStreamedItem.uuid !== item.uuid;

        if (isNewItem && _this2.pendingSaveTimeout) {
          clearTimeout(_this2.pendingSaveTimeout);

          _this2._performSavingOfItems(_this2.pendingSaveParams);

          _this2.pendingSaveTimeout = null;
          _this2.pendingSaveParams = null;
        }

        _this2.lastStreamedItem = item;
        callback(_this2.lastStreamedItem);
      });
    }
  }, {
    key: "selectItem",
    value: function selectItem(item) {
      this.postMessage("select-item", {
        item: this.jsonObjectForItem(item)
      });
    }
  }, {
    key: "createItem",
    value: function createItem(item, callback) {
      this.postMessage("create-item", {
        item: this.jsonObjectForItem(item)
      }, function (data) {
        var item = data.item; // A previous version of the SN app had an issue where the item in the reply to create-item
        // would be nested inside "items" and not "item". So handle both cases here.

        if (!item && data.items && data.items.length > 0) {
          item = data.items[0];
        }

        this.associateItem(item);
        callback && callback(item);
      }.bind(this));
    }
  }, {
    key: "createItems",
    value: function createItems(items, callback) {
      var _this3 = this;

      var mapped = items.map(function (item) {
        return _this3.jsonObjectForItem(item);
      });
      this.postMessage("create-items", {
        items: mapped
      }, function (data) {
        callback && callback(data.items);
      }.bind(this));
    }
  }, {
    key: "associateItem",
    value: function associateItem(item) {
      this.postMessage("associate-item", {
        item: this.jsonObjectForItem(item)
      });
    }
  }, {
    key: "deassociateItem",
    value: function deassociateItem(item) {
      this.postMessage("deassociate-item", {
        item: this.jsonObjectForItem(item)
      });
    }
  }, {
    key: "clearSelection",
    value: function clearSelection() {
      this.postMessage("clear-selection", {
        content_type: "Tag"
      });
    }
  }, {
    key: "deleteItem",
    value: function deleteItem(item, callback) {
      this.deleteItems([item], callback);
    }
  }, {
    key: "deleteItems",
    value: function deleteItems(items, callback) {
      var params = {
        items: items.map(function (item) {
          return this.jsonObjectForItem(item);
        }.bind(this))
      };
      this.postMessage("delete-items", params, function (data) {
        callback && callback(data);
      });
    }
  }, {
    key: "sendCustomEvent",
    value: function sendCustomEvent(action, data, callback) {
      this.postMessage(action, data, function (data) {
        callback && callback(data);
      }.bind(this));
    }
  }, {
    key: "saveItem",
    value: function saveItem(item, callback) {
      var skipDebouncer = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : false;
      this.saveItems([item], callback, skipDebouncer);
    }
    /* Presave allows clients to perform any actions last second before the save actually occurs (like setting previews).
       Saves debounce by default, so if a client needs to compute a property on an item before saving, it's best to
       hook into the debounce cycle so that clients don't have to implement their own debouncing.
     */

  }, {
    key: "saveItemWithPresave",
    value: function saveItemWithPresave(item, presave, callback) {
      this.saveItemsWithPresave([item], presave, callback);
    }
  }, {
    key: "saveItemsWithPresave",
    value: function saveItemsWithPresave(items, presave, callback) {
      this.saveItems(items, callback, false, presave);
    }
  }, {
    key: "_performSavingOfItems",
    value: function _performSavingOfItems(_ref) {
      var items = _ref.items,
          presave = _ref.presave,
          callback = _ref.callback;
      // presave block allows client to gain the benefit of performing something in the debounce cycle.
      presave && presave();
      var mappedItems = [];
      var _iteratorNormalCompletion2 = true;
      var _didIteratorError2 = false;
      var _iteratorError2 = undefined;

      try {
        for (var _iterator2 = items[Symbol.iterator](), _step2; !(_iteratorNormalCompletion2 = (_step2 = _iterator2.next()).done); _iteratorNormalCompletion2 = true) {
          var item = _step2.value;
          mappedItems.push(this.jsonObjectForItem(item));
        }
      } catch (err) {
        _didIteratorError2 = true;
        _iteratorError2 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion2 && _iterator2["return"] != null) {
            _iterator2["return"]();
          }
        } finally {
          if (_didIteratorError2) {
            throw _iteratorError2;
          }
        }
      }

      this.postMessage("save-items", {
        items: mappedItems
      }, function (data) {
        callback && callback();
      });
    }
    /*
    skipDebouncer allows saves to go through right away rather than waiting for timeout.
    This should be used when saving items via other means besides keystrokes.
    */

  }, {
    key: "saveItems",
    value: function saveItems(items, callback) {
      var _this4 = this;

      var skipDebouncer = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : false;
      var presave = arguments.length > 3 ? arguments[3] : undefined;

      // We need to make sure that when we clear a pending save timeout,
      // we carry over those pending items into the new save.
      if (!this.pendingSaveItems) {
        this.pendingSaveItems = [];
      }

      if (this.coallesedSaving == true && !skipDebouncer) {
        if (this.pendingSaveTimeout) {
          clearTimeout(this.pendingSaveTimeout);
        }

        var incomingIds = items.map(function (item) {
          return item.uuid;
        }); // Replace any existing save items with incoming values
        // Only keep items here who are not in incomingIds

        var preexistingItems = this.pendingSaveItems.filter(function (item) {
          return !incomingIds.includes(item.uuid);
        }); // Add new items, now that we've made sure it's cleared of incoming items.

        this.pendingSaveItems = preexistingItems.concat(items); // We'll potentially need to commit early if stream-context-item message comes in

        this.pendingSaveParams = {
          items: this.pendingSaveItems,
          presave: presave,
          callback: callback
        };
        this.pendingSaveTimeout = setTimeout(function () {
          _this4._performSavingOfItems(_this4.pendingSaveParams);

          _this4.pendingSaveItems = [];
          _this4.pendingSaveTimeout = null;
          _this4.pendingSaveParams = null;
        }, this.coallesedSavingDelay);
      } else {
        this._performSavingOfItems({
          items: items,
          presave: presave,
          callback: callback
        });
      }
    }
  }, {
    key: "jsonObjectForItem",
    value: function jsonObjectForItem(item) {
      var copy = Object.assign({}, item);
      copy.children = null;
      copy.parent = null;
      return copy;
    }
  }, {
    key: "getItemAppDataValue",
    value: function getItemAppDataValue(item, key) {
      var AppDomain = "org.standardnotes.sn";
      var data = item.content.appData && item.content.appData[AppDomain];

      if (data) {
        return data[key];
      } else {
        return null;
      }
    }
    /* Themes */

  }, {
    key: "activateThemes",
    value: function activateThemes(incomingUrls) {
      if (this.loggingEnabled) {
        console.log("Incoming themes", incomingUrls);
      }

      if (this.activeThemes.sort().toString() == incomingUrls.sort().toString()) {
        // incoming are same as active, do nothing
        return;
      }

      var themesToActivate = incomingUrls || [];
      var themesToDeactivate = [];
      var _iteratorNormalCompletion3 = true;
      var _didIteratorError3 = false;
      var _iteratorError3 = undefined;

      try {
        for (var _iterator3 = this.activeThemes[Symbol.iterator](), _step3; !(_iteratorNormalCompletion3 = (_step3 = _iterator3.next()).done); _iteratorNormalCompletion3 = true) {
          var activeUrl = _step3.value;

          if (!incomingUrls.includes(activeUrl)) {
            // active not present in incoming, deactivate it
            themesToDeactivate.push(activeUrl);
          } else {
            // already present in active themes, remove it from themesToActivate
            themesToActivate = themesToActivate.filter(function (candidate) {
              return candidate != activeUrl;
            });
          }
        }
      } catch (err) {
        _didIteratorError3 = true;
        _iteratorError3 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion3 && _iterator3["return"] != null) {
            _iterator3["return"]();
          }
        } finally {
          if (_didIteratorError3) {
            throw _iteratorError3;
          }
        }
      }

      if (this.loggingEnabled) {
        console.log("Deactivating themes:", themesToDeactivate);
        console.log("Activating themes:", themesToActivate);
      }

      for (var _i = 0, _themesToDeactivate = themesToDeactivate; _i < _themesToDeactivate.length; _i++) {
        var theme = _themesToDeactivate[_i];
        this.deactivateTheme(theme);
      }

      this.activeThemes = incomingUrls;
      var _iteratorNormalCompletion4 = true;
      var _didIteratorError4 = false;
      var _iteratorError4 = undefined;

      try {
        for (var _iterator4 = themesToActivate[Symbol.iterator](), _step4; !(_iteratorNormalCompletion4 = (_step4 = _iterator4.next()).done); _iteratorNormalCompletion4 = true) {
          var url = _step4.value;

          if (!url) {
            continue;
          }

          var link = document.createElement("link");
          link.id = btoa(url);
          link.href = url;
          link.type = "text/css";
          link.rel = "stylesheet";
          link.media = "screen,print";
          link.className = "custom-theme";
          document.getElementsByTagName("head")[0].appendChild(link);
        }
      } catch (err) {
        _didIteratorError4 = true;
        _iteratorError4 = err;
      } finally {
        try {
          if (!_iteratorNormalCompletion4 && _iterator4["return"] != null) {
            _iterator4["return"]();
          }
        } finally {
          if (_didIteratorError4) {
            throw _iteratorError4;
          }
        }
      }
    }
  }, {
    key: "themeElementForUrl",
    value: function themeElementForUrl(url) {
      var elements = Array.from(document.getElementsByClassName("custom-theme")).slice();
      return elements.find(function (element) {
        // We used to search here by `href`, but on desktop, with local file:// urls, that didn't work for some reason.
        return element.id == btoa(url);
      });
    }
  }, {
    key: "deactivateTheme",
    value: function deactivateTheme(url) {
      var element = this.themeElementForUrl(url);

      if (element) {
        element.disabled = true;
        element.parentNode.removeChild(element);
      }
    }
    /* Theme caching is currently disabled. Might be enabled in the future if neccessary. */

    /*
    activateCachedThemes() {
      let themes = this.getCachedThemeUrls();
      let writeToCache = false;
      if(this.loggingEnabled) { console.log("Activating cached themes", themes); }
      this.activateThemes(themes, writeToCache);
    }
     cacheThemeUrls(urls) {
      if(this.loggingEnabled) { console.log("Caching theme urls", urls); }
      localStorage.setItem("cachedThemeUrls", JSON.stringify(urls));
    }
     decacheThemeUrls() {
      localStorage.removeItem("cachedThemeUrls");
    }
     getCachedThemeUrls() {
      let urls = localStorage.getItem("cachedThemeUrls");
      if(urls) {
        return JSON.parse(urls);
      } else {
        return [];
      }
    }
    */

    /* Utilities */

  }, {
    key: "generateUUID",
    value: function generateUUID() {
      var crypto = window.crypto || window.msCrypto;

      if (crypto) {
        var buf = new Uint32Array(4);
        crypto.getRandomValues(buf);
        var idx = -1;
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
          idx++;
          var r = buf[idx >> 3] >> idx % 8 * 4 & 15;
          var v = c == 'x' ? r : r & 0x3 | 0x8;
          return v.toString(16);
        });
      } else {
        var d = new Date().getTime();

        if (window.performance && typeof window.performance.now === "function") {
          d += performance.now(); //use high-precision timer if available
        }

        var uuid = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
          var r = (d + Math.random() * 16) % 16 | 0;
          d = Math.floor(d / 16);
          return (c == 'x' ? r : r & 0x3 | 0x8).toString(16);
        });
        return uuid;
      }
    }
  }]);

  return ComponentManager;
}();

if (typeof module != "undefined" && typeof module.exports != "undefined") {
  module.exports = ComponentManager;
}

if (window) {
  window.ComponentManager = ComponentManager;
}
//# sourceMappingURL=dist.js.map
;(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
"use strict";

function _typeof(obj) { if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") { _typeof = function _typeof(obj) { return typeof obj; }; } else { _typeof = function _typeof(obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }; } return _typeof(obj); }

document.addEventListener("DOMContentLoaded", function (event) {
  var editor = document.getElementById("editor-source");
  var workingNote;
  var permissions = [{
    name: "stream-context-item"
  }];
  var componentManager = new ComponentManager(permissions, function () {
    // on ready
    var platform = componentManager.platform;

    if (platform) {
      document.body.classList.add(platform);
    }
  }); // componentManager.loggingEnabled = true;

  componentManager.streamContextItem(function (note) {
    workingNote = note; // Only update UI on non-metadata updates.

    if (note.isMetadataUpdate) {
      return;
    }

    editor.value = note.content.text;
    window.upmath.updateText();
  });
  editor.addEventListener("input", function (event) {
    var text = editor.value || "";

    function strip(html) {
      var tmp = document.implementation.createHTMLDocument("New").body;
      tmp.innerHTML = html;
      return tmp.textContent || tmp.innerText || "";
    }

    function truncateString(string) {
      var limit = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 90;

      if (string.length <= limit) {
        return string;
      } else {
        return string.substring(0, limit) + "...";
      }
    }

    function save() {
      componentManager.saveItem(workingNote);
    }

    if (workingNote) {
      // Be sure to capture this object as a variable, as workingNote may be reassigned in `streamContextItem`, so by the time
      // you modify it in the presave block, it may not be the same object anymore, so the presave values will not be applied to
      // the right object, and it will save incorrectly.
      var note = workingNote;
      componentManager.saveItemWithPresave(note, function () {
        window.upmath.updateText();
        var html = window.upmath.getHTML();
        var strippedHtml = truncateString(strip(html));
        note.content.preview_plain = strippedHtml;
        note.content.preview_html = null;
        note.content.text = text;
      });
    }
  }); // Tab handler

  editor.addEventListener('keydown', function (event) {
    if (!event.shiftKey && event.which == 9) {
      event.preventDefault();
      console.log(document); // Using document.execCommand gives us undo support

      if (!document.execCommand("insertText", false, "\t")) {
        // document.execCommand works great on Chrome/Safari but not Firefox
        var start = this.selectionStart;
        var end = this.selectionEnd;
        var spaces = "    "; // Insert 4 spaces

        this.value = this.value.substring(0, start) + spaces + this.value.substring(end); // Place cursor 4 spaces away from where
        // the tab key was pressed

        this.selectionStart = this.selectionEnd = start + 4;
      }
    }
  });
});
;
/**
* Markdown and LaTeX Editor
*
* (c) Roman Parpalak, 2016-2018
*/

(function (document, window) {
  'use strict';

  var defaults = {
    html: true,
    // Enable HTML tags in source
    xhtmlOut: false,
    // Use '/' to close single tags (<br />)
    breaks: false,
    // Convert '\n' in paragraphs into <br>
    langPrefix: 'language-',
    // CSS language prefix for fenced blocks
    linkify: true,
    // autoconvert URL-like texts to links
    typographer: true,
    // Enable smartypants and other sweet transforms
    quotes: '""\'\'',
    // option for tex plugin
    _habr: {
      protocol: ''
    },
    // no protocol for habrahabr markup
    // options below are for demo only
    _highlight: true,
    _strict: false
  };

  function domSetResultView(val) {
    var eNode = document.body;
    ['result-as-html', 'result-as-htmltex', 'result-as-habr', 'result-as-src', 'result-as-debug'].forEach(function (className) {
      if (eNode.classList) {
        eNode.classList.remove(className);
      } else {
        eNode.className = eNode.className.replace(new RegExp('(^|\\b)' + className.split(' ').join('|') + '(\\b|$)', 'gi'), ' ');
      }
    });

    if (eNode.classList) {
      eNode.classList.add('result-as-' + val);
    } else {
      eNode.className += ' ' + 'result-as-' + val;
    }
  }

  function ParserCollection(defaults, imageLoader, markdownit, setResultView, sourceGetter, sourceSetter, domSetPreviewHTML, domSetHighlightedContent, updateCallback) {
    var _mdPreview = markdownit(defaults).use(markdownitSub).use(markdownitSup);

    var _mdHtmlAndImages = markdownit(defaults).use(markdownitSub).use(markdownitSup);

    var _mdHtmlAndTex = markdownit(defaults).use(markdownitSub).use(markdownitSup);

    var _mdHtmlHabrAndImages = markdownit(defaults).use(markdownitSub).use(markdownitSup);

    var _mdMdAndImages = markdownit('zero');
    /**
     * Detects if the paragraph contains the only formula.
     * Parser gives the class 'tex-block' to such formulas.
     *
     * @param tokens
     * @param idx
     * @returns {boolean}
     */


    function hasBlockFormula(tokens, idx) {
      if (idx >= 0 && tokens[idx] && tokens[idx].children) {
        for (var i = tokens[idx].children.length; i--;) {
          if (tokens[idx].children[i].tag === 'tex-block') {
            return true;
          }
        }
      }

      return false;
    }
    /**
     * Inject line numbers for sync scroll. Notes:
     * - We track only headings and paragraphs on first level. That's enough.
     * - Footnotes content causes jumps. Level limit filter it automatically.
     *
     * @param tokens
     * @param idx
     * @param options
     * @param env
     * @param self
     */


    function injectLineNumbersAndCentering(tokens, idx, options, env, self) {
      var line;

      if (tokens[idx].map && tokens[idx].level === 0) {
        line = tokens[idx].map[0];
        tokens[idx].attrPush(['class', 'line']);
        tokens[idx].attrPush(['data-line', line + '']);
      } // Hack (maybe it is better to use block renderers?)


      if (hasBlockFormula(tokens, idx + 1)) {
        tokens[idx].attrPush(['align', 'center']);
        tokens[idx].attrPush(['style', 'text-align: center;']);
      }

      return self.renderToken(tokens, idx, options, env, self);
    } // Habrahabr does not ignore <p> tags and meanwhile uses whitespaces


    function habrHeading(tokens, idx, options, env, self) {
      var prefix = "";

      if (idx > 0 && tokens[idx - 1].type === 'paragraph_close' && !hasBlockFormula(tokens, idx - 2)) {
        prefix = "\n";
      }

      return prefix + self.renderToken(tokens, idx, options, env, self);
    }

    function habrParagraphOpen(tokens, idx, options, env, self) {
      var prefix = "";

      if (idx > 0 && tokens[idx - 1].type === 'paragraph_close' && !hasBlockFormula(tokens, idx - 2)) {
        prefix = "\n";
      }

      return prefix; //+ self.renderToken(tokens, idx, options, env, self);
    }

    function habrParagraphClose(tokens, idx, options, env, self) {
      var prefix = "\n";
      return prefix; //+ self.renderToken(tokens, idx, options, env, self);
    }

    function injectCentering(tokens, idx, options, env, self) {
      // Hack (maybe it is better to use block renderers?)
      if (hasBlockFormula(tokens, idx + 1)) {
        tokens[idx].attrPush(['align', 'center']);
        tokens[idx].attrPush(['style', 'text-align: center;']);
      }

      return self.renderToken(tokens, idx, options, env, self);
    }

    _mdPreview.renderer.rules.paragraph_open = _mdPreview.renderer.rules.heading_open = injectLineNumbersAndCentering;
    _mdHtmlAndImages.renderer.rules.paragraph_open = _mdHtmlAndImages.renderer.rules.heading_open = injectCentering;
    _mdHtmlHabrAndImages.renderer.rules.heading_open = habrHeading;
    _mdHtmlHabrAndImages.renderer.rules.paragraph_open = habrParagraphOpen;
    _mdHtmlHabrAndImages.renderer.rules.paragraph_close = habrParagraphClose; // A copy of Markdown-it original backticks parser.
    // We want to prevent from parsing dollars inside backticks as TeX delimeters (`$$`).
    // But we do not want HTML in result.

    _mdMdAndImages.inline.ruler.before('backticks', 'backticks2', function (state, silent) {
      var start,
          max,
          marker,
          matchStart,
          matchEnd,
          token,
          pos = state.pos,
          ch = state.src.charCodeAt(pos);

      if (ch !== 0x60
      /* ` */
      ) {
          return false;
        }

      start = pos;
      pos++;
      max = state.posMax;

      while (pos < max && state.src.charCodeAt(pos) === 0x60
      /* ` */
      ) {
        pos++;
      }

      marker = state.src.slice(start, pos);
      matchStart = matchEnd = pos;

      while ((matchStart = state.src.indexOf('`', matchEnd)) !== -1) {
        matchEnd = matchStart + 1;

        while (matchEnd < max && state.src.charCodeAt(matchEnd) === 0x60
        /* ` */
        ) {
          matchEnd++;
        }

        if (matchEnd - matchStart === marker.length) {
          if (!silent) {
            token = state.push('backticks2_inline', 'code', 0); // <-- The change

            token.markup = marker;
            token.content = state.src.slice(pos, matchStart);
          }

          state.pos = matchEnd;
          return true;
        }
      }

      if (!silent) {
        state.pending += marker;
      }

      state.pos += marker.length;
      return true;
    });

    _mdMdAndImages.renderer.rules.backticks2_inline = function (tokens, idx
    /*, options, env, slf*/
    ) {
      var token = tokens[idx];
      return token.markup + token.content + token.markup;
    }; // Prevents HTML escaping.


    _mdMdAndImages.renderer.rules.text = function (tokens, idx
    /*, options, env */
    ) {
      return tokens[idx].content;
    };
    /**
     * Habrahabr "source" tag
     *
     * @param tokens
     * @param idx
     * @param options
     * @param env
     * @param self
     * @returns {string}
     */


    _mdHtmlHabrAndImages.renderer.rules.fence = function (tokens, idx, options, env, self) {
      var token = tokens[idx],
          info = token.info ? _mdHtmlHabrAndImages.utils.unescapeAll(token.info).trim() : '',
          langName = '',
          highlighted;

      if (info) {
        langName = info.split(/\s+/g)[0];
        token.attrPush(['lang', langName]);
      }

      if (options.highlight) {
        highlighted = options.highlight(token.content, langName) || _mdHtmlHabrAndImages.utils.escapeHtml(token.content);
      } else {
        highlighted = _mdHtmlHabrAndImages.utils.escapeHtml(token.content);
      }

      return '\n<source' + self.renderAttrs(token) + '>' + highlighted + '</source>\n';
    };

    function getHabraMarkup(source) {
      var html = _mdHtmlHabrAndImages.render(source);

      html = html.replace('<spoiler ', '\n<spoiler ');
      return html;
    }

    this.getSource = sourceGetter;

    this.setSource = function (source) {
      sourceSetter(source);
      this.updateResult();
    };

    var _oldSource = null,
        _view = 'html'; // html / src / debug

    this.updateResult = function () {
      var source = sourceGetter();

      if (_oldSource === source) {
        return;
      }

      _oldSource = source; // Always render html because we need it to generate previews for SN

      imageLoader.reset();
      domSetPreviewHTML(_mdPreview.render(source));
      imageLoader.fixDom();

      if (_view === 'debug') {
        domSetHighlightedContent('result-src-content', JSON.stringify(_mdHtmlAndImages.parse(source, {
          references: {}
        }), null, 2), 'json');
      } else if (_view === 'habr') {
        domSetHighlightedContent('result-src-content', getHabraMarkup(source), 'html');
      } else if (_view === 'md') {
        domSetHighlightedContent('result-src-content', _mdMdAndImages.renderInline(source), 'html');
      } else {
        /*_view === 'src'*/
        domSetHighlightedContent('result-src-content', _mdHtmlAndImages.render(source), 'html');
      }

      updateCallback(source);
    };

    this.getDisplayedResult = function () {
      var source = sourceGetter();

      if (_view === 'habr') {
        return _mdHtmlHabrAndImages.render(source);
      }

      if (_view === 'md') {
        return _mdMdAndImages.renderInline(source);
      }

      return _mdHtmlAndImages.render(source);
    };

    this.getDisplayedResultFilename = function () {
      return _view + '.html';
    };

    setResultView(_view);

    this.switchView = function (view) {
      _view = view;
      setResultView(view);
      _oldSource = null;
      this.updateResult();
    };
  }

  function domSetHighlightedContent(className, content, lang) {
    var eNode = document.getElementsByClassName(className)[0];

    if (window.hljs) {
      eNode.innerHTML = window.hljs.highlight(lang, content).value;
    } else {
      eNode.textContent = content;
    }
  }

  function domSetPreviewHTML(html) {
    var result = document.getElementsByClassName('result-html');
    result[0].innerHTML = html;
  }
  /**
   * Searches start position for text blocks
   */


  function domFindScrollMarks() {
    var resElements = document.querySelectorAll('.result-html .line'),
        resElementHeight = [],
        line,
        mapSrc = [0],
        mapResult = [0],
        i = 0,
        len = resElements.length;

    for (; i < len; i++) {
      line = parseInt(resElements[i].getAttribute('data-line'));

      if (line) {
        resElementHeight[line] = Math.round(resElements[i].offsetTop);
      }
    }

    var srcElements = document.querySelectorAll('.ldt-pre .block-start');
    len = srcElements.length;
    line = 0;

    for (i = 0; i < len; i++) {
      var lineDelta = parseInt(srcElements[i].getAttribute('data-line'));

      if (lineDelta) {
        line += lineDelta; // We track only lines in both containers

        if (typeof resElementHeight[line] !== 'undefined') {
          mapSrc.push(srcElements[i].offsetTop);
          mapResult.push(resElementHeight[line]);
        }
      }
    }

    var srcScrollHeight = document.querySelector('.ldt-pre').scrollHeight,
        lastSrcElemPos = mapSrc[mapSrc.length - 1],
        allowedHeight = 5; // workaround for automatic textarea scrolling on entering new source lines

    mapSrc.push(srcScrollHeight - allowedHeight > lastSrcElemPos ? srcScrollHeight - allowedHeight : lastSrcElemPos);
    mapResult.push(document.querySelector('.result-html').scrollHeight);
    return [mapSrc, mapResult];
  }

  documentReady(function () {
    var eTextarea = document.getElementById('editor-source'),
        eResultHtml = document.getElementsByClassName('result-html')[0];
    var recalcHeight = debounce(function () {
      decorator.recalcHeight();
    }, 100);
    var scrollMap = new ScrollMap(domFindScrollMarks);
    var parserCollection = new ParserCollection(defaults, new ImageLoader(new ImagePreloader(), location.protocol === 'https:' ? 'https:' : 'http:'), window.markdownit, domSetResultView, function domGetSource() {
      return eTextarea.value;
    }, function domSetSource(text) {
      eTextarea.value = text;
      decorator.update();
    }, domSetPreviewHTML, domSetHighlightedContent, function (source) {
      // reset lines mapping cache on content update
      scrollMap.reset();
    });
    parserCollection.updateResult(); // start the decorator

    var decorator = new TextareaDecorator(eTextarea, mdParser); // .source has been changed after TextareaDecorator call

    var eNodeSource = document.getElementsByClassName('source')[0];
    var syncScroll = new SyncScroll(scrollMap, new Animator(function () {
      return eNodeSource.scrollTop;
    }, function (y) {
      eNodeSource.scrollTop = y;
    }), new Animator(function () {
      return eResultHtml.scrollTop;
    }, function (y) {
      eResultHtml.scrollTop = y;
    }), eNodeSource, eResultHtml, document.querySelector('[id^="container-block"]')); // Sync scroll listeners
    // var updateText = debounce(parserCollection.updateResult, 240, {maxWait: 3000});
    // We'll update text on our own

    var _updateText = parserCollection.updateResult; // eTextarea.addEventListener('keyup', updateText);
    // eTextarea.addEventListener('paste', updateText);
    // eTextarea.addEventListener('cut', updateText);
    // eTextarea.addEventListener('mouseup', updateText);

    eTextarea.addEventListener('touchstart', syncScroll.switchScrollToSrc);
    eTextarea.addEventListener('mouseover', syncScroll.switchScrollToSrc);
    eResultHtml.addEventListener('touchstart', syncScroll.switchScrollToResult);
    eResultHtml.addEventListener('mouseover', syncScroll.switchScrollToResult);
    syncScroll.switchScrollToSrc();
    Array.prototype.forEach.call(document.getElementsByClassName('control-item'), function (eNode, index) {
      eNode.addEventListener('click', function () {
        var view = this.getAttribute('data-result-as');

        if (!view) {
          return;
        }

        parserCollection.switchView(view);

        if (view !== 'preview') {
          // Selecting all block content.
          var contentBlocks = document.getElementsByClassName('result-src-content');

          if (contentBlocks.length) {
            setTimeout(function () {
              selectText(contentBlocks[0]);
            }, 0);
          }
        }
      });
    }); // Interface element listeners

    document.querySelector('._download-source').addEventListener('click', function () {
      var blob = new Blob([parserCollection.getSource()], {
        type: 'text/markdown;charset=utf-8'
      });
      saveAs(blob, 'source.md');
    });
    document.querySelector('._download-result').addEventListener('click', function () {
      var blob = new Blob([parserCollection.getDisplayedResult()], {
        type: 'text/html;charset=utf-8'
      });
      saveAs(blob, parserCollection.getDisplayedResultFilename());
    });
    document.querySelector('._upload-source').addEventListener('click', function () {
      var eNode = document.getElementById('fileElem'); // Fire click on file input

      (eNode.onclick || eNode.click || function () {}).call(eNode);
    });
    document.getElementById('fileElem').addEventListener('change', function () {
      // A file has been chosen
      if (!this.files || !FileReader) {
        return;
      }

      var reader = new FileReader(),
          fileInput = this;

      reader.onload = function () {
        parserCollection.setSource(this.result);
        fileInput.value = fileInput.defaultValue;
      };

      reader.readAsText(this.files[0]);
    });

    (function () {
      var eSlider = document.querySelector('.slider'),
          dragSlider = new Draggabilly(eSlider, {
        axis: 'x'
      }),
          sourceBlock = document.getElementById('source-block'),
          resultBLock = document.getElementById('result-block'),
          windowWidth;

      function setWidth(percent) {
        sourceBlock.style.width = 'calc(' + percent + '% - 3px)';
        resultBLock.style.width = 'calc(' + (100 - percent) + '% - 3px)';
        scrollMap.reset();
      }

      eSlider.addEventListener('dblclick', function () {
        setWidth(50);
      });
      dragSlider.on('dragStart', function (event, pointer, moveVector) {
        windowWidth = window.innerWidth;
      });
      dragSlider.on('dragMove', function (event, pointer, moveVector) {
        setWidth(100.0 * pointer.pageX / windowWidth);
      });
    })();

    window.upmath = {
      updateText: function updateText() {
        _updateText();

        decorator.recalcHeight();
        decorator.update();
      },
      getHTML: function getHTML() {
        var result = document.getElementsByClassName('result-html');
        return eResultHtml.innerHTML;
      }
    }; // Need to recalculate line positions on window resize

    window.addEventListener('resize', function () {
      scrollMap.reset();
      recalcHeight();
    });
  });
})(document, window);

;
/**
* Markdown parser with latex extension
*
* (c) Roman Parpalak, 2015
* Based on code by Colin Kuebler, 2012
*/

function MarkdownParser(i) {
  /* INIT */
  var api = this; // variables used internally

  i = i ? 'i' : '';
  var parseInlineRE = null,
      parseBlockRE = null,
      ruleMap = {},
      ruleBlockMap = {},
      ruleInlineMap = {},
      runInBlocks = {},
      markers = {};
  var subRules,
      subRulesMap = {},
      subRulesRE = {};

  function addBlockRule(s, rule) {
    var re = new RegExp('^(' + s + ')$', i);
    ruleMap[rule] = re;
    ruleBlockMap[rule] = re;
  }

  function addInlineRule(s, rule) {
    var re = new RegExp('^(' + s + ')$', i);
    ruleMap[rule] = re;
    ruleInlineMap[rule] = re;
  }

  function addSubruleMap(s, rule, block) {
    if (!subRulesMap[block]) {
      subRulesMap[block] = {};
    }

    subRulesMap[block][rule] = new RegExp('^(' + s + ')$', i);
  }

  api.addInlineRules = function (rules) {
    var ruleSrc = [];

    for (var rule in rules) {
      if (rules.hasOwnProperty(rule)) {
        var s = rules[rule].source;
        ruleSrc.push(s);
        addInlineRule(s, rule);
      }
    }

    parseInlineRE = new RegExp('(' + ruleSrc.join('|') + ')', i);
    return this;
  };

  api.addSubRules = function (rules) {
    subRules = rules;

    for (var block in rules) {
      if (rules.hasOwnProperty(block)) {
        var rules2 = rules[block],
            p = [];

        for (var rule in rules2) {
          if (rules2.hasOwnProperty(rule)) {
            var s = rules2[rule].source;
            addSubruleMap(s, rule, block);
            p.push(s);
          }
        }

        subRulesRE[block] = new RegExp('(' + p.join('|') + ')', i);
      }
    }

    return this;
  };

  api.addBlockRules = function (rules) {
    var ruleArray = [];

    for (var rule in rules) {
      if (rules.hasOwnProperty(rule)) {
        var s = rules[rule].source;
        ruleArray.push(s);
        addBlockRule(s, rule);
      }
    }

    parseBlockRE = new RegExp('(' + ruleArray.join('|') + ')', i);
    return this;
  };

  api.addRunIn = function (rules) {
    runInBlocks = rules;
    return this;
  };

  api.addMarkers = function (m) {
    markers = m;
    return this;
  };

  function tokenizeBlock(block, className, lineNum, result) {
    var re = parseInlineRE; // Process specific rules for the given block type className

    if (className in subRules) {
      if (subRules[className] === null) {
        result.push({
          token: block,
          block: className,
          line: lineNum
        });
        return;
      } else {
        re = subRulesRE[className];
      }
    } // Token for a block marker


    if (typeof markers[className] !== 'undefined') {
      var matches = block.match(markers[className]);

      if (matches[2]) {
        result.push({
          token: matches[1],
          block: className + '-mark',
          line: lineNum
        });
        block = matches[2];
        lineNum = 0; // Write block position only once
      }
    }

    var items = block.split(re),
        j = 0,
        token;

    for (; j < items.length; j++) {
      token = items[j];

      if (token != '') {
        result.push({
          token: token,
          block: className,
          line: lineNum
        });
        lineNum = 0; // Write block position only once
      }
    }
  }

  api.tokenize = function (input) {
    input = input.replace('\r', '');
    var result = [],
        classNames = [],
        blocks = input.split(parseBlockRE),
        blockNum = blocks.length,
        i,
        prevIndex = 0,
        prevBlockClass; // Merge blocks separated by line breaks

    for (i = 0; i < blockNum; i++) {
      if (blocks[i] === '') {
        continue;
      }

      var className = identify(blocks[i], ruleBlockMap);

      if (prevIndex > 0 && className in runInBlocks) {
        var allowedPrevBlocks = runInBlocks[className].allowedBlocks;

        if (allowedPrevBlocks && allowedPrevBlocks.indexOf(prevBlockClass) >= 0) {
          blocks[prevIndex] += blocks[i];
          blocks[i] = '';
          classNames[i] = '';
          continue;
        }
      }

      classNames[i] = className;
      prevIndex = i;
      prevBlockClass = className;
    }

    var lineBreakCnt = 0;

    for (i = 0; i < blockNum; i++) {
      var block = blocks[i];

      if (block !== '') {
        var lineNum = 0;

        if (classNames[i] != 'empty') {
          // TODO move to config
          lineNum = lineBreakCnt;
          lineBreakCnt = 0; // Storing diff between line numbers
        }

        tokenizeBlock(block, classNames[i], lineNum, result);
        lineBreakCnt += substrCount('\n', block);
      }
    }

    return result;
  };

  api.identifyInline = function (tokenObj) {
    var className = tokenObj.block,
        map = ruleInlineMap;

    if (className in subRules) {
      if (subRules[className] === null) {
        return '';
      } else {
        map = subRulesMap[className];
      }
    }

    return identify(tokenObj.token, map);
  };

  function identify(token, ruleMap) {
    for (var rule in ruleMap) {
      if (ruleMap.hasOwnProperty(rule) && ruleMap[rule].test(token)) {
        return rule;
      }
    }

    return '';
  }

  return api;
} // Markdown syntax parser


var mdParser = new MarkdownParser();
mdParser.addBlockRules({
  latexBlock: /[ \t]*\$\$\n?(?:[^\n]+\n)*(?:[^\n]*[^\\\n])?\$\$(?:[ \t]*\([ \t]*\S+[ \t]*\))?[ \t]*(?:\n|$)/,
  empty: /(?:[ \t]*\n)+/,
  fence: /```[\s\S]*?(?:$|```(?:\n|$))/,
  reference: /\[[^\]]+\]\:[^\n]*(?:\n|$)/,
  header: /#{1,6} [^\n]*(?:\n|$)/,
  header2: /[^\n]+\n[ \t]*[=-]{2,}(?:\n|$)/,
  rule: /(?:[\*]{3,}|[\-]{3,}|[\_]{3,})(?:\n|$)/,
  list: /[ ]{0,3}(?:[+\-\*]|\d+\.)[ \t]+[^\n]*(?:\n[ \t]*[^\n\t ]+[ \t]*)*(?:\n|$)/,
  quote: /[ ]{0,3}>[^\n]*(?:\n|$)/,
  paragraph: /[\s\S]*?(?:\n|$)/
}).addInlineRules({
  latex: /\$\$(?:[\s\S]*?[^\\])?\$\$/,
  link: /\[.+?\][\(\[].*?[\)\]]/,
  bold: /(?:\s|^)__[\s\S]*?\S__|\*\*[\s\S]*?\S\*\*/,
  italic: /(?:\s|^)_[\s\S]*?[^\\\s]_|\*[^\\\s]\*|\*\S[\s\S]*?[^\\\s]\*/,
  strike: /~~.+?~~/,
  sup: /\^.+?\^/,
  sub: /~.+?~/,
  code: /``.+?``|`.*?[^`\\]`(?!`)/
}).addSubRules({
  fence: null,
  rule: null,
  latexBlock: {
    comment: /%[^\n]*?(?=\$\$)|%[^\n]*/,
    reference: /[ \t]*\([ \t]*\S+[ \t]*\)[ \t\n]*$/,
    index: /(?:\^|_)(?:\\[a-zA-Zа-яА-я]+[\*]?(?:\{.*?\})|\{[a-zA-Zа-яА-я0-9]*?\}|[a-zA-Zа-яА-я0-9])/,
    bracket: /(?:(?:\\left|\\right)?[\{\}\[\]\(\)\|])/,
    keyword: /\\[a-zA-Zа-яА-я]+[\*]?/,
    keyword2: /\\[^a-zA-Zа-яА-я0-9]/,
    keyword3: /&/,
    delimeter: /\$\$/
  }
}).addRunIn({
  paragraph: {
    allowedBlocks: ['paragraph', 'quote', 'list']
  }
}).addMarkers({
  list: /^([ ]{0,3}(?:[+\-\*]|\d+\.)[ \t]+)([\s\S]*)$/,
  quote: /^([ ]{0,3}(?:>[ \t]*)+)([\s\S]*)$/
});
;
'use strict';
/**
 * DOMContentLoaded polyfill
 *
 * @param fn
 */


function documentReady(fn) {
  if (document.readyState != 'loading') {
    fn();
  } else {
    document.addEventListener('DOMContentLoaded', fn);
  }
}
/**
 * Find the index of a maximum value in values array
 * which is less than maxValue.
 *
 * @param maxValue
 * @param values
 *
 * @returns {object}
 */


function findBisect(maxValue, values) {
  var a = 0,
      b = values.length - 1,
      f_a = values[a];

  if (f_a >= maxValue) {
    return {
      val: a,
      part: 0
    };
  }

  var f_b = values[b];

  if (f_b < maxValue) {
    return {
      val: b,
      part: 0
    };
  }

  while (b - a > 1) {
    var c = a + Math.round((b - a) / 2),
        f_c = values[c];

    if (f_c >= maxValue) {
      b = c;
      f_b = f_c;
    } else {
      a = c;
      f_a = f_c;
    }
  }

  return {
    val: a,
    part: (maxValue - f_a) / (f_b - f_a)
  };
}
/**
 * Count the number of occurances of a substring in a string
 *
 * @param substr
 * @param str
 * @returns {number}
 */


function substrCount(substr, str) {
  var count = -1,
      index = -2;

  while (index != -1) {
    count++;
    index = str.indexOf(substr, index + 1);
  }

  return count;
}
/**
 * Selects the content of the given DOM node.
 *
 * @param eNode
 */


function selectText(eNode) {
  if (!window.getSelection) {
    return;
  }

  var selection = window.getSelection(),
      range = document.createRange();
  range.selectNodeContents(eNode);
  selection.removeAllRanges();
  selection.addRange(range);
}
/**
 * Realistic animation module based on one-dimensional physical model.
 *
 * @param positionGetter
 * @param positionSetter
 * @constructor
 */


function Animator(positionGetter, positionSetter) {
  var x = 0,
      x1 = 0,
      x2 = 0,
      v = 0,
      animationTime = 200,
      timerId,
      startedAt = null;

  var loop = function loop(timestamp) {
    if (startedAt === null) {
      startedAt = timestamp;
    }

    var moveTime = timestamp - startedAt;

    if (moveTime < moveDuration) {
      // New position and velocity
      x = x2 + A * (Math.cos(omega * (moveTime - moveDuration)) - 1);
      v = A * omega * Math.sin(omega * (moveDuration - moveTime));
      positionSetter(x);
      timerId = requestAnimationFrame(loop);

      if (isReInit) {
        /**
         * If the position has been forced, we run the animation again.
         */
        initMotion(reInitPosition, x);
        isReInit = false;
        startedAt = timestamp;
      }
    } else {
      // Stop the animation
      startedAt = null;
      v = 0;
      positionSetter(x2);
      cancelAnimationFrame(timerId);

      if (isReInit) {
        isReInit = false;
      }
    }
  };
  /**
   * The moveDuration of animation. It can be less than animationTime in case of high speed.
   */


  var moveDuration;
  /**
   * Motion parameters. See the loop formulas.
   */

  var A, omega;
  /**
   * Flag fired when the final position has been changed during running amination.
   */

  var isReInit = false;
  /**
   * New value for final position (that has been changed during running amination).
   */

  var reInitPosition;
  /**
   * Calculate parameters A and omega for the position given by formula
   *
   * x(t) = x0 + A * (Math.cos(omega * (t - t0)) - 1);
   *
   * @param newPosition
   * @param oldPosition
   */

  function initMotion(newPosition, oldPosition) {
    var k;
    x2 = newPosition;
    x1 = oldPosition;

    if (Math.abs(v) < 0.00001) {
      // Rest
      k = Math.PI;
      moveDuration = animationTime;
    } else {
      // Motion
      var alpha = (x2 - x1) / v / animationTime; // Motion parameter

      /**
       * Instead of solving non-linear equation alpha * k = tan(k/2)
       * we use approximation 0.5/a = 1 - (k/pi)^2
       */

      if (alpha < 0 || alpha > 0.5) {
        k = Math.PI * Math.sqrt(1 - 0.5 / alpha);
      } else {
        k = 0.1;
      }
      /**
       * After approximate value of k is determined, we redefine alpha
       * since its value affects the animation. It means that the total
       * animation duration (moveDuration) differs from animationTime.
       * However, the difference does not impact the user experience.
       */


      var alpha1 = (1 - Math.cos(k)) / k / Math.sin(k);
      moveDuration = (x2 - x1) / alpha1 / v;
    }

    omega = k / moveDuration;
    A = (x2 - x1) / (1 - Math.cos(k));
  }
  /**
   * Public control method
   *
   * @param nextPos
   */


  this.setPos = function (nextPos) {
    isReInit = startedAt !== null;

    if (!isReInit) {
      x = positionGetter();
      initMotion(nextPos, x);
      timerId = requestAnimationFrame(loop);
    } else {
      reInitPosition = nextPos;
    }
  };

  this.stop = function () {
    startedAt = null;
    v = 0;
    cancelAnimationFrame(timerId);
    isReInit = false;
  };
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}
/**
 * See http://stackoverflow.com/questions/1144783/replacing-all-occurrences-of-a-string-in-javascript
 * @param search
 * @param replacement
 * @returns {string}
 */


String.prototype.replaceAll = function (search, replacement) {
  var target = this;
  return target.replace(new RegExp(escapeRegExp(search), 'g'), replacement);
};
/**
 *
 * @constructor
 */


function ImagePreloader() {
  var data = {},
      uniqueIndex = 0;

  function ajaxReady() {
    var svg;

    if (this.status >= 200 && this.status < 400) {
      svg = this.responseText;
    } else {
      // We reached our target server, but it returned an error
      svg = '<svg height="24" version="1.1" width="24" xmlns="http://www.w3.org/2000/svg">' + '<g transform="translate(0 -1028.4)">' + '<path d="m22 12c0 5.523-4.477 10-10 10-5.5228 0-10-4.477-10-10 0-5.5228 4.4772-10 10-10 5.523 0 10 4.4772 10 10z" fill="#742600" transform="translate(0 1029.4)"/>' + '<path d="m22 12c0 5.523-4.477 10-10 10-5.5228 0-10-4.477-10-10 0-5.5228 4.4772-10 10-10 5.523 0 10 4.4772 10 10z" fill="#AB562B" transform="translate(0 1028.4)"/>' + '<path d="m7.0503 1037.8 3.5357 3.6-3.5357 3.5 1.4142 1.4 3.5355-3.5 3.536 3.5 1.414-1.4-3.536-3.5 3.536-3.6-1.414-1.4-3.536 3.5-3.5355-3.5-1.4142 1.4z" fill="#742600"/>' + '<path d="m7.0503 1036.8 3.5357 3.6-3.5357 3.5 1.4142 1.4 3.5355-3.5 3.536 3.5 1.414-1.4-3.536-3.5 3.536-3.6-1.414-1.4-3.536 3.5-3.5355-3.5-1.4142 1.4z" fill="#ecf0f1"/>' + '</g>' + '</svg>';
    }

    setImage(this.responseURL || this.s2Url, svg);
  }

  function loadImage(url) {
    var request = new XMLHttpRequest();
    request.open('GET', url, true);
    request.s2Url = url;
    request.onload = ajaxReady;

    request.onerror = function () {// There was a connection error of some sort
    };

    request.send();
    return request;
  }

  this.onLoad = function (url, callback) {
    if (!data[url]) {
      data[url] = {
        svg: null,
        baseline: null,
        request: loadImage(url),
        callback: callback
      };
    } else if (data[url].svg !== null) {
      callback(url, data[url].svg, data[url].baseline);
    } // In case of duplicate pictures we skip duplicates (when data[url].svg === null)

  };
  /**
   * Make ids in svg unique across the html code by adding a prefix.
   *
   * @param svg
   * @returns {*}
   */


  function makeSvgIdsUnique(svg) {
    var m = svg.match(/id=["']([^"']*)["']/g);

    if (!m) {
      return svg;
    }

    var i = m.length,
        id,
        newId,
        curStr;

    for (; i--;) {
      curStr = m[i];
      id = curStr.match(/id=["']([^"']*)["']/)[1];
      newId = 's' + uniqueIndex + id;
      svg = svg.replaceAll(curStr, 'id="' + newId + '"').replaceAll('#' + id, '#' + newId);
    }

    uniqueIndex++;
    return svg;
  }
  /**
   * Stores sizes, source and removes the xhr object.
   * @param url
   * @param svg
   */


  var setImage = function setImage(url, svg) {
    var urlData = data[url];

    if (!urlData) {
      return;
    }

    svg = makeSvgIdsUnique(svg);
    var m = svg.match(/postMessage\((?:&quot;|")([\d\|\.\-eE]*)(?:&quot;|")/); // ["&quot;2.15299|31.42377|11.65223|&quot;", "2.15299|31.42377|11.65223|"]

    if (m) {
      var baselineShift = m && m[1] ? m[1].split('|').shift() : 0; // 2.15299
    } else {
      // svg can be empty like "<svg xmlns="http://www.w3.org/2000/svg"/>"
      // Mark as something is wrong.
      baselineShift = null;
    }

    urlData.callback(url, svg, baselineShift);
    urlData.svg = svg;
    urlData.baseline = baselineShift;
    urlData.request = null;
    urlData.callback = null;
  };
  /**
   * External API
   *
   * @param url
   * @returns {null}
   */


  this.getImageDataFromUrl = function (url) {
    var urlData = data[url];
    return urlData ? urlData : null;
  };
}
/**
 *
 * @param preloader
 * @param protocol  Needed for support the "file:" protocol.
 * @constructor
 */


function ImageLoader(preloader, protocol) {
  var curItems = [],
      // current formula content
  prevItems = [],
      // previous formula content
  map = {},
      // maps formula content to index
  n = 0,
      // current formula number
  placeholderTimer = null,
      placeholderIndex = null,
      placeholderUrl = null;
  /**
   * Find if user has edited only one formula formula.
   */

  function detectPlaceholderFormula() {
    if (n == prevItems.length) {
      var editNum = 0,
          index,
          i = n;

      for (; i--;) {
        if (curItems[i] != prevItems[i]) {
          editNum++;
          index = i;
        }
      }

      if (editNum == 1) {
        if (placeholderIndex === null) {
          // A formula has been changed.
          // Use previous one as a placeholder.
          placeholderIndex = index;
          placeholderUrl = prevItems[index];
          return;
        }

        if (placeholderIndex === index) {
          // Formula has been changed again since previous change,
          // but the previous image has not been loaded yet.
          // Keep previous placeholder.
          return;
        }
      }
    } // Many formulas has been changed. We do not display any placeholders.


    placeholderIndex = null;
    placeholderUrl = null;
  }

  function buildMap() {
    map = {};

    for (var i = n; i--;) {
      var url = curItems[i];

      if (typeof map[url] === 'undefined') {
        map[url] = [i];
      } else {
        map[url].push(i);
      }
    }
  }
  /**
   * Start parsing process.
   */


  this.reset = function () {
    curItems = [];
    n = 0;
  };
  /**
   * Insert SVG images.
   *
   * @param url
   * @param svg
   * @param baselineShift
   */


  var callback = function callback(url, svg, baselineShift) {
    var indexes = map[url],
        i;

    if (indexes && (i = indexes.length)) {
      for (; i--;) {
        var index = indexes[i];
        insertPicture(index, svg, baselineShift, index === placeholderIndex ? 'fade-in' : 'replace');

        if (index === placeholderIndex) {
          // Clear the fade out timer if the new image has just bee
          clearTimeout(placeholderTimer);
          placeholderIndex = null;
          placeholderUrl = null;
        }
      }
    }
  };
  /**
   * Mark formula as loading.
   * Use previous image but transparent.
   *
   * @param index
   * @param svg
   * @param baselineShift
   * @param mode One of 'replace', 'fade-in', 'fade-out'
   */


  function insertPicture(index, svg, baselineShift, mode) {
    var id = 's2tex_' + index,
        oldSvgNode = document.getElementById(id),
        parentNode = oldSvgNode.parentNode,
        startOpacity = '1',
        // mode == 'fade-in' ? '0.5' : '1', // sometimes images opacity can be '1' yet. How can one track it?
    finalOpacity = mode == 'fade-out' ? '0.5' : '1',
        newSvgAttrs = '<svg class="svg-preview" id="' + id + '" ';

    if (baselineShift === null) {
      // svg has been loaded but something went wrong.
      newSvgAttrs += 'width="13px" height="13px" ';
    } else {
      newSvgAttrs += 'style="vertical-align:' + -baselineShift + 'pt; opacity: ' + startOpacity + '" ';
    } // Polyfill for outerHTML


    var divNode = document.createElement('div');
    divNode.innerHTML = svg.replace('<svg ', newSvgAttrs);
    var newSvgNode = divNode.firstElementChild; // there can be comments before <svg>

    divNode.removeChild(newSvgNode);
    parentNode.insertBefore(newSvgNode, oldSvgNode);
    parentNode.removeChild(oldSvgNode);

    if (finalOpacity != startOpacity) {
      placeholderTimer = setTimeout(function () {
        document.getElementById(id).style.opacity = finalOpacity;
      }, 0);
    }
  }
  /**
   * Finish the parsing process.
   */


  this.fixDom = function () {
    detectPlaceholderFormula();
    buildMap();

    for (var i = n; i--;) {
      preloader.onLoad(curItems[i], callback);
    }

    if (placeholderIndex !== null) {
      var data = preloader.getImageDataFromUrl(placeholderUrl);

      if (data !== null && data.callback === null) {
        insertPicture(placeholderIndex, data.svg, data.baseline, 'fade-out');
      }
    }

    prevItems = curItems.slice(0);
  };
}
/**
 * Access to the map between blocks in sync scroll.
 *
 * @param mapBuilder
 * @constructor
 */


function ScrollMap(mapBuilder) {
  var map = null;

  this.reset = function () {
    map = [null, null];
  };

  this.getPosition = function (eBlockNode, fromIndex, toIndex) {
    var offsetHeight = eBlockNode.offsetHeight;
    var scrollTop = eBlockNode.scrollTop;

    if (scrollTop == 0) {
      return 0;
    }

    if (map[fromIndex] === null) {
      map = mapBuilder();
    }

    var maxMapIndex = map[fromIndex].length - 1;

    if (map[fromIndex][maxMapIndex] <= scrollTop + offsetHeight) {
      return map[toIndex][maxMapIndex] - offsetHeight;
    }

    var scrollShift = offsetHeight / 2,
        scrollLevel = scrollTop + scrollShift,
        blockIndex = findBisect(scrollLevel, map[fromIndex]),
        srcScrollLevel = parseFloat(map[toIndex][blockIndex.val] * (1 - blockIndex.part));

    if (map[toIndex][blockIndex.val + 1]) {
      srcScrollLevel += parseFloat(map[toIndex][blockIndex.val + 1] * blockIndex.part);
    }

    return srcScrollLevel - scrollShift;
  };
}
/**
 * Controls sync scroll of the source and preview blocks
 *
 * @param scrollMap
 * @param animatorSrc
 * @param animatorResult
 * @param eSrc
 * @param eResult
 * @param eContainer
 * @constructor
 */


function SyncScroll(scrollMap, animatorSrc, animatorResult, eSrc, eResult, eContainer) {
  // Synchronize scroll position from source to result
  var syncResultScroll = function syncResultScroll() {
    animatorResult.setPos(scrollMap.getPosition(eSrc, 0, 1));
  }; // Synchronize scroll position from result to source


  var syncSrcScroll = function syncSrcScroll() {
    animatorSrc.setPos(scrollMap.getPosition(eResult, 1, 0));
  };

  this.switchScrollToSrc = function () {
    eResult.removeEventListener('scroll', syncSrcScroll);
    eSrc.removeEventListener('scroll', syncResultScroll);
    eSrc.addEventListener('scroll', syncResultScroll);
    eContainer.id = 'container-block-source'; // animatorSrc.stop();
  };

  this.switchScrollToResult = function () {
    eSrc.removeEventListener('scroll', syncResultScroll);
    eResult.removeEventListener('scroll', syncSrcScroll);
    eResult.addEventListener('scroll', syncSrcScroll);
    eContainer.id = 'container-block-result'; // animatorResult.stop();
  };
}
/**
 * Functions from lodash.js
 * @see https://github.com/lodash/lodash/
 */


var now = Date.now || function () {
  return new Date().getTime();
};

function debounce(func, wait, options) {
  var args,
      maxTimeoutId,
      result,
      stamp,
      thisArg,
      timeoutId,
      trailingCall,
      lastCalled = 0,
      leading = false,
      maxWait = false,
      trailing = true;

  if (typeof func != 'function') {
    throw new TypeError(FUNC_ERROR_TEXT);
  }

  wait = wait < 0 ? 0 : +wait || 0;

  if (_typeof(options) === 'object') {
    leading = !!options.leading;
    maxWait = 'maxWait' in options && Math.max(+options.maxWait || 0, wait);
    trailing = 'trailing' in options ? !!options.trailing : trailing;
  }

  function cancel() {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    if (maxTimeoutId) {
      clearTimeout(maxTimeoutId);
    }

    lastCalled = 0;
    maxTimeoutId = timeoutId = trailingCall = undefined;
  }

  function complete(isCalled, id) {
    if (id) {
      clearTimeout(id);
    }

    maxTimeoutId = timeoutId = trailingCall = undefined;

    if (isCalled) {
      lastCalled = now();
      result = func.apply(thisArg, args);

      if (!timeoutId && !maxTimeoutId) {
        args = thisArg = undefined;
      }
    }
  }

  function delayed() {
    var remaining = wait - (now() - stamp);

    if (remaining <= 0 || remaining > wait) {
      complete(trailingCall, maxTimeoutId);
    } else {
      timeoutId = setTimeout(delayed, remaining);
    }
  }

  function maxDelayed() {
    complete(trailing, timeoutId);
  }

  function debounced() {
    args = arguments;
    stamp = now();
    thisArg = this;
    trailingCall = trailing && (timeoutId || !leading);

    if (maxWait === false) {
      var leadingCall = leading && !timeoutId;
    } else {
      if (!maxTimeoutId && !leading) {
        lastCalled = stamp;
      }

      var remaining = maxWait - (stamp - lastCalled),
          isCalled = remaining <= 0 || remaining > maxWait;

      if (isCalled) {
        if (maxTimeoutId) {
          maxTimeoutId = clearTimeout(maxTimeoutId);
        }

        lastCalled = stamp;
        result = func.apply(thisArg, args);
      } else if (!maxTimeoutId) {
        maxTimeoutId = setTimeout(maxDelayed, remaining);
      }
    }

    if (isCalled && timeoutId) {
      timeoutId = clearTimeout(timeoutId);
    } else if (!timeoutId && wait !== maxWait) {
      timeoutId = setTimeout(delayed, wait);
    }

    if (leadingCall) {
      isCalled = true;
      result = func.apply(thisArg, args);
    }

    if (isCalled && !timeoutId && !maxTimeoutId) {
      args = thisArg = undefined;
    }

    return result;
  }

  debounced.cancel = cancel;
  return debounced;
}

;
/**
* TextareaDecorator.js
* written by Colin Kuebler 2012
* Updated by Roman Parpalak, 2015.
* Part of LDT, dual licensed under GPLv3 and MIT
* Builds and maintains a styled output layer under a textarea input layer
*/

function TextareaDecorator(textarea, parser) {
  /* INIT */
  var api = this,
      output;

  if (textarea.className !== 'ldt-textarea') {
    // construct editor DOM
    var parent = document.createElement("div");
    output = document.createElement("pre");
    output.className = 'ldt-pre';
    parent.appendChild(output);
    var label = document.createElement("label");
    label.className = 'ldt-label';
    parent.appendChild(label); // replace the textarea with RTA DOM and reattach on label

    textarea.parentNode.replaceChild(parent, textarea);
    label.appendChild(textarea); // transfer the CSS styles to our editor

    parent.className = 'ldt ' + textarea.className;
    textarea.className = 'ldt-textarea';
  } else {
    output = textarea.parentNode.previousSibling;
  }
  /**
   * Composes token class.
   *
   * Tokens are grouped into blocks.
   * Also a token have its own type.
   *
   * @param blockClass  token block type
   * @param inlineClass token type
   * @returns {string}
   */


  function getClass(blockClass, inlineClass) {
    return blockClass + ' ' + inlineClass;
  }
  /**
   * Detect changes between a token and its DOM representation.
   *
   * @param newToken hash object
   * @param oldNode  DOM node converted from old hash object
   *
   * @returns {boolean}
   */


  function compareTokens(newToken, oldNode) {
    if (newToken.token !== oldNode.textContent) {
      return false;
    }

    var className = oldNode.className,
        oldBlock = className.slice(0, className.indexOf(' '));

    if (oldBlock !== newToken.block) {
      return false;
    }

    var line = oldNode.getAttribute('data-line');

    if (line && line != newToken.line) {
      return false;
    }

    return true;
  }
  /**
   * Updates a DOM node by a token
   *
   * @param node
   * @param token
   * @param inlineClass
   */


  function fillTokenNode(node, token, inlineClass) {
    node.textContent = node.innerText = token.token;
    var c = getClass(token.block, inlineClass);

    if (token.line) {
      node.className = c + ' block-start';
      node.setAttribute('data-line', token.line);
    } else {
      node.className = c;
    }
  } // coloring algorithm


  var color = function color(input, output, parser) {
    var lastChar = input !== '' && input.substring(input.length - 1) || '';

    if (lastChar == "\r" || lastChar == "\n") {
      // Hack for the case when the last line in textarea is empty
      input += ' ';
    }

    var nodes = output.childNodes,
        tokens = parser.tokenize(input),
        firstDiff,
        lastDiffNew,
        lastDiffOld; // find the first difference

    for (firstDiff = 0; firstDiff < tokens.length && firstDiff < nodes.length; firstDiff++) {
      if (!compareTokens(tokens[firstDiff], nodes[firstDiff])) {
        break;
      }
    } // trim the length of output nodes to the size of the input


    while (tokens.length < nodes.length) {
      output.removeChild(nodes[firstDiff]);
    } // find the last difference


    for (lastDiffNew = tokens.length - 1, lastDiffOld = nodes.length - 1; firstDiff < lastDiffOld; lastDiffNew--, lastDiffOld--) {
      if (!compareTokens(tokens[lastDiffNew], nodes[lastDiffOld])) {
        break;
      }
    } // update modified nodes


    for (; firstDiff <= lastDiffOld; firstDiff++) {
      var token = tokens[firstDiff];
      fillTokenNode(nodes[firstDiff], token, parser.identifyInline(token));
    } // add in modified nodes


    for (var insertionPt = nodes[firstDiff] || null; firstDiff <= lastDiffNew; firstDiff++) {
      var span = document.createElement("span");
      token = tokens[firstDiff];
      fillTokenNode(span, token, parser.identifyInline(token));
      output.insertBefore(span, insertionPt);
    }
  };

  api.input = textarea;
  api.output = output;

  api.recalcHeight = function () {
    api.input.style.height = Math.max(api.output.offsetHeight, 100) + 'px';
  };

  api.update = function () {
    var input = textarea.value;

    if (input) {
      color(input, output, parser);
    } else {
      // clear the display
      output.innerHTML = '';
    }

    api.recalcHeight();
  }; // detect all changes to the textarea,
  // including keyboard input, cut/copy/paste, drag & drop, etc


  if (textarea.addEventListener) {
    // standards browsers: oninput event
    textarea.addEventListener("input", api.update, false);
  } else {
    // MSIE: detect changes to the 'value' property
    textarea.attachEvent("onpropertychange", function (e) {
      if (e.propertyName.toLowerCase() === 'value') {
        api.update();
      }
    });
  } // initial highlighting


  api.update();
  return api;
}
/* FileSaver.js
 * A saveAs() FileSaver implementation.
 * 2015-05-07.2
 *
 * By Eli Grey, http://eligrey.com
 * License: X11/MIT
 *   See https://github.com/eligrey/FileSaver.js/blob/master/LICENSE.md
 */

/*global self */

/*jslint bitwise: true, indent: 4, laxbreak: true, laxcomma: true, smarttabs: true, plusplus: true */

/*! @source http://purl.eligrey.com/github/FileSaver.js/blob/master/FileSaver.js */


var saveAs = saveAs || function (view) {
  "use strict"; // IE <10 is explicitly unsupported

  if (typeof navigator !== "undefined" && /MSIE [1-9]\./.test(navigator.userAgent)) {
    return;
  }

  var doc = view.document // only get URL when necessary in case Blob.js hasn't overridden it yet
  ,
      get_URL = function get_URL() {
    return view.URL || view.webkitURL || view;
  },
      save_link = doc.createElementNS("http://www.w3.org/1999/xhtml", "a"),
      can_use_save_link = "download" in save_link,
      click = function click(node) {
    var event = doc.createEvent("MouseEvents");
    event.initMouseEvent("click", true, false, view, 0, 0, 0, 0, 0, false, false, false, false, 0, null);
    node.dispatchEvent(event);
  },
      webkit_req_fs = view.webkitRequestFileSystem,
      req_fs = view.requestFileSystem || webkit_req_fs || view.mozRequestFileSystem,
      throw_outside = function throw_outside(ex) {
    (view.setImmediate || view.setTimeout)(function () {
      throw ex;
    }, 0);
  },
      force_saveable_type = "application/octet-stream",
      fs_min_size = 0 // See https://code.google.com/p/chromium/issues/detail?id=375297#c7 and
  // https://github.com/eligrey/FileSaver.js/commit/485930a#commitcomment-8768047
  // for the reasoning behind the timeout and revocation flow
  ,
      arbitrary_revoke_timeout = 500 // in ms
  ,
      revoke = function revoke(file) {
    var revoker = function revoker() {
      if (typeof file === "string") {
        // file is an object URL
        get_URL().revokeObjectURL(file);
      } else {
        // file is a File
        file.remove();
      }
    };

    if (view.chrome) {
      revoker();
    } else {
      setTimeout(revoker, arbitrary_revoke_timeout);
    }
  },
      dispatch = function dispatch(filesaver, event_types, event) {
    event_types = [].concat(event_types);
    var i = event_types.length;

    while (i--) {
      var listener = filesaver["on" + event_types[i]];

      if (typeof listener === "function") {
        try {
          listener.call(filesaver, event || filesaver);
        } catch (ex) {
          throw_outside(ex);
        }
      }
    }
  },
      auto_bom = function auto_bom(blob) {
    // prepend BOM for UTF-8 XML and text/* types (including HTML)
    if (/^\s*(?:text\/\S*|application\/xml|\S*\/\S*\+xml)\s*;.*charset\s*=\s*utf-8/i.test(blob.type)) {
      return new Blob(["\uFEFF", blob], {
        type: blob.type
      });
    }

    return blob;
  },
      FileSaver = function FileSaver(blob, name) {
    blob = auto_bom(blob); // First try a.download, then web filesystem, then object URLs

    var filesaver = this,
        type = blob.type,
        blob_changed = false,
        object_url,
        target_view,
        dispatch_all = function dispatch_all() {
      dispatch(filesaver, "writestart progress write writeend".split(" "));
    } // on any filesys errors revert to saving with object URLs
    ,
        fs_error = function fs_error() {
      // don't create more object URLs than needed
      if (blob_changed || !object_url) {
        object_url = get_URL().createObjectURL(blob);
      }

      if (target_view) {
        target_view.location.href = object_url;
      } else {
        var new_tab = view.open(object_url, "_blank");

        if (new_tab == undefined && typeof safari !== "undefined") {
          //Apple do not allow window.open, see http://bit.ly/1kZffRI
          view.location.href = object_url;
        }
      }

      filesaver.readyState = filesaver.DONE;
      dispatch_all();
      revoke(object_url);
    },
        abortable = function abortable(func) {
      return function () {
        if (filesaver.readyState !== filesaver.DONE) {
          return func.apply(this, arguments);
        }
      };
    },
        create_if_not_found = {
      create: true,
      exclusive: false
    },
        slice;

    filesaver.readyState = filesaver.INIT;

    if (!name) {
      name = "download";
    }

    if (can_use_save_link) {
      object_url = get_URL().createObjectURL(blob);
      save_link.href = object_url;
      save_link.download = name;
      click(save_link);
      filesaver.readyState = filesaver.DONE;
      dispatch_all();
      revoke(object_url);
      return;
    } // Object and web filesystem URLs have a problem saving in Google Chrome when
    // viewed in a tab, so I force save with application/octet-stream
    // http://code.google.com/p/chromium/issues/detail?id=91158
    // Update: Google errantly closed 91158, I submitted it again:
    // https://code.google.com/p/chromium/issues/detail?id=389642


    if (view.chrome && type && type !== force_saveable_type) {
      slice = blob.slice || blob.webkitSlice;
      blob = slice.call(blob, 0, blob.size, force_saveable_type);
      blob_changed = true;
    } // Since I can't be sure that the guessed media type will trigger a download
    // in WebKit, I append .download to the filename.
    // https://bugs.webkit.org/show_bug.cgi?id=65440


    if (webkit_req_fs && name !== "download") {
      name += ".download";
    }

    if (type === force_saveable_type || webkit_req_fs) {
      target_view = view;
    }

    if (!req_fs) {
      fs_error();
      return;
    }

    fs_min_size += blob.size;
    req_fs(view.TEMPORARY, fs_min_size, abortable(function (fs) {
      fs.root.getDirectory("saved", create_if_not_found, abortable(function (dir) {
        var save = function save() {
          dir.getFile(name, create_if_not_found, abortable(function (file) {
            file.createWriter(abortable(function (writer) {
              writer.onwriteend = function (event) {
                target_view.location.href = file.toURL();
                filesaver.readyState = filesaver.DONE;
                dispatch(filesaver, "writeend", event);
                revoke(file);
              };

              writer.onerror = function () {
                var error = writer.error;

                if (error.code !== error.ABORT_ERR) {
                  fs_error();
                }
              };

              "writestart progress write abort".split(" ").forEach(function (event) {
                writer["on" + event] = filesaver["on" + event];
              });
              writer.write(blob);

              filesaver.abort = function () {
                writer.abort();
                filesaver.readyState = filesaver.DONE;
              };

              filesaver.readyState = filesaver.WRITING;
            }), fs_error);
          }), fs_error);
        };

        dir.getFile(name, {
          create: false
        }, abortable(function (file) {
          // delete file if it already exists
          file.remove();
          save();
        }), abortable(function (ex) {
          if (ex.code === ex.NOT_FOUND_ERR) {
            save();
          } else {
            fs_error();
          }
        }));
      }), fs_error);
    }), fs_error);
  },
      FS_proto = FileSaver.prototype,
      saveAs = function saveAs(blob, name) {
    return new FileSaver(blob, name);
  }; // IE 10+ (native saveAs)


  if (typeof navigator !== "undefined" && navigator.msSaveOrOpenBlob) {
    return function (blob, name) {
      return navigator.msSaveOrOpenBlob(auto_bom(blob), name);
    };
  }

  FS_proto.abort = function () {
    var filesaver = this;
    filesaver.readyState = filesaver.DONE;
    dispatch(filesaver, "abort");
  };

  FS_proto.readyState = FS_proto.INIT = 0;
  FS_proto.WRITING = 1;
  FS_proto.DONE = 2;
  FS_proto.error = FS_proto.onwritestart = FS_proto.onprogress = FS_proto.onwrite = FS_proto.onabort = FS_proto.onerror = FS_proto.onwriteend = null;
  return saveAs;
}(typeof self !== "undefined" && self || typeof window !== "undefined" && window || (void 0).content); // `self` is undefined in Firefox for Android content script context
// while `this` is nsIContentFrameMessageManager
// with an attribute `content` that corresponds to the window


if (typeof module !== "undefined" && module.exports) {
  module.exports.saveAs = saveAs;
} else if (typeof define !== "undefined" && define !== null && define.amd != null) {
  define([], function () {
    return saveAs;
  });
}

},{}]},{},[1]);
