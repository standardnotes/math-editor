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
			.use(markdownitS2Tex)
			.use(markdownitSub)
			.use(markdownitSup)
		;

		var _mdHtmlAndImages = markdownit(defaults)
			.use(markdownitS2Tex)
			.use(markdownitSub)
			.use(markdownitSup)
		;

		var _mdHtmlAndTex = markdownit(defaults)
			.use(markdownitS2Tex, {noreplace: true})
			.use(markdownitSub)
			.use(markdownitSup)
		;

		var _mdHtmlHabrAndImages = markdownit(defaults)
			.use(markdownitS2Tex, defaults._habr)
			.use(markdownitSub)
			.use(markdownitSup)
		;

		var _mdMdAndImages = markdownit('zero')
			.use(markdownitS2Tex)
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

		// Custom image embedding for smooth UX
		_mdPreview.renderer.rules.math_inline = function (tokens, idx) {
			return imageLoader.getHtmlStub(tokens[idx].content);
		};

		/**
		 * Habrahabr hack for numerating formulas
		 */
		_mdHtmlHabrAndImages.renderer.rules.math_number = function (tokens, idx) {
			return '<img align="right" src="//tex.s2cms.ru/svg/' + tokens[idx].content + '" />';
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

			// Update only active view to avoid slowdowns
			// (debug & src view with highlighting are a bit slow)
			if (_view === 'htmltex') {
				domSetHighlightedContent('result-src-content', '<script src="https://tex.s2cms.ru/latex.js"></script>\n' + _mdHtmlAndTex.render(source), 'html');
			}
			else if (_view === 'debug') {
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

			if (_view === 'htmltex') {
				return '<script src="https://tex.s2cms.ru/latex.js"></script>\n' + _mdHtmlAndTex.render(source);
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
 * Connects service to the markdown-it renderer.
 *
 * Inspired by https://github.com/runarberg/markdown-it-math
 *
 * @copyright 2015 Roman Parpalak
 */

(function (w) {
	'use strict';

	function scanDelims(state, start) {
		var pos = state.pos, lastChar, nextChar, count,
			isLastWhiteSpace, isLastPunctChar,
			isNextWhiteSpace, isNextPunctChar,
			can_open  = true,
			can_close = true,
			max = state.posMax,
			isWhiteSpace   = state.md.utils.isWhiteSpace,
			isPunctChar    = state.md.utils.isPunctChar,
			isMdAsciiPunct = state.md.utils.isMdAsciiPunct;

		// treat beginning of the line as a whitespace
		lastChar = start > 0 ? state.src.charCodeAt(start - 1) : 0x20;
		if (pos >= max) {
			can_open = false;
		}
		count = pos - start;

		// treat end of the line as a whitespace
		nextChar = pos < max ? state.src.charCodeAt(pos) : 0x20;
		isLastPunctChar = isMdAsciiPunct(lastChar) || isPunctChar(String.fromCharCode(lastChar));
		isNextPunctChar = isMdAsciiPunct(nextChar) || isPunctChar(String.fromCharCode(nextChar));
		isLastWhiteSpace = isWhiteSpace(lastChar);
		isNextWhiteSpace = isWhiteSpace(nextChar);

		if (isNextWhiteSpace) {
			can_open = false;
		}
		else if (isNextPunctChar) {
			if (!(isLastWhiteSpace || isLastPunctChar)) {
				can_open = false;
			}
		}
		if (isLastWhiteSpace) {
			can_close = false;
		}
		else if (isLastPunctChar) {
			if (!(isNextWhiteSpace || isNextPunctChar)) {
				can_close = false;
			}
		}

		return {
			can_open: can_open,
			can_close: can_close,
			delims: count
		};
	}


	function makeMath_inline(open, close) {
		return function math_inline(state, silent) {
			var startCount,
				found,
				res,
				token,
				closeDelim,
				max = state.posMax,
				start = state.pos,
				openDelim = state.src.slice(start, start + open.length);

			if (openDelim !== open) {
				return false;
			}
			if (silent) {
				return false;
			}    // Don’t run any pairs in validation mode

			res = scanDelims(state, start + open.length);
			startCount = res.delims;

			if (!res.can_open) {
				state.pos += startCount;
				// Earlier we checked !silent, but this implementation does not need it
				state.pending += state.src.slice(start, state.pos);
				return true;
			}

			state.pos = start + open.length;

			while (state.pos < max) {
				closeDelim = state.src.slice(state.pos, state.pos + close.length);
				if (closeDelim === close) {
					res = scanDelims(state, state.pos + close.length);
					if (res.can_close) {
						found = true;
						break;
					}
				}

				state.md.inline.skipToken(state);
			}

			if (!found) {
				// Parser failed to find ending tag, so it is not a valid math
				state.pos = start;
				return false;
			}

			// Found!

			// Detecting single formula with a line number
			var m = false,
				tag = 'tex-inline';

			if (start == 0) {
				var srcEnd = state.src.substring(state.pos + close.length);
				m = srcEnd.match(/^\s*(\([ \t]*\S+[ \t]*\))\s*$/);
				if (m || srcEnd == '') {
					tag = 'tex-block';
				}
			}

			if (m) {
				token = state.push('math_number', 'tex-number', 0);
				token.content = m[1];
				token.markup = '()';
			}

			state.posMax = state.pos;
			state.pos = start + close.length;

			// Earlier we checked !silent, but this implementation does not need it
			token = state.push('math_inline', tag, 0);
			token.content = state.src.slice(state.pos, state.posMax);
			token.markup = open;

			state.pos = m ? max : state.posMax + close.length;
			state.posMax = max;

			return true;
		};
	}

	w.markdownitS2Tex = function math_plugin(md, options) {
		// Default options
		options = typeof options === 'object' ? options : {};
		var inlineOpen  = options.inlineOpen || '$$',
			inlineClose = options.inlineClose || '$$';

		var math_inline = makeMath_inline(inlineOpen, inlineClose);

		md.inline.ruler.before('escape', 'math_inline', math_inline);

		md.renderer.rules.math_inline = (function (protocol) {
			protocol = typeof options.protocol !== 'undefined' ? options.protocol : protocol;
			return function (tokens, idx) {
				var formula = tokens[idx].content;

				if (options.noreplace) {
					var str = inlineOpen + formula + inlineClose;
					return str
						.replace(/&/g, '&amp;')
						.replace(/>/g, '&gt;')
						.replace(/</g, '&lt;')
						.replace(/"/g, '&quot;')
					;
				}

				var url      = protocol + '//tex.s2cms.ru/svg/' + encodeURIComponent(formula),
					isInline = "tex-inline" === tokens[idx].tag;

				return isInline
						? '<img src="' + url + '" alt="' + md.utils.escapeHtml(formula) + '" />'
						: '<img align="center" src="' + url + '" alt="' + md.utils.escapeHtml(formula) + '" />';
			}
		}(location.protocol == "https:" ? "https:" : 'http:')); // support for file: protocol

		md.renderer.rules.math_number = function (tokens, idx) {
			return '<span style="float:right">' + tokens[idx].content + '</span>';
		};
	};
}(window));
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
	 * Generate the picture HTML code while parsing and store the state.
	 *
	 * @param formula
	 * @returns {string}
	 */
	this.getHtmlStub = function (formula) {
		curItems[n] = protocol + '//tex.s2cms.ru/svg/' + encodeURIComponent(formula);

		var html = '<span id="s2tex_' + n + '"></span>';

		n++;

		return html;
	};

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
