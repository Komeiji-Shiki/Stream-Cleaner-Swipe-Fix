/**
 * Stream Cleaner & Swipe Fix
 * ──────────────────────────
 * 功能1：消除段落间多余空行（流式期间用 CSS 隐藏，结束后 DOM 清理）
 * 功能2：Swipe左右切换回复后保持滚动位置，不再跳到顶部
 * 功能3：段首自动补两个全角空格缩进（仅生成结束后执行）
 *
 * @author 灰魂×主人
 */
(function () {
    'use strict';

    const TAG = '[StreamCleaner]';

    // 目标区域选择器（正文 + 思维链）
    const TARGET_SELECTOR = '.mes_text, .mes_reasoning';

    // =====================================================================
    //  注入 CSS：流式期间零闪烁地隐藏空行
    // =====================================================================

    const STYLE_ID = 'stream-cleaner-css';

    function injectCSS() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;

        // 为 .mes_text 和 .mes_reasoning 生成相同的规则
        const areas = ['#chat .mes_text', '#chat .mes_reasoning'];
        const rules = areas.flatMap((a) => [
            // ── 空段落（任意嵌套深度） ──
            `${a} p:empty { display: none !important; }`,
            `${a} p:has(> br:only-child) { display: none !important; }`,

            // ── 顶层直接子级的连续 <br>（块级元素间的空行） ──
            `${a} > br + br { display: none !important; }`,
            `${a} > br + span.text_segment:has(> br:only-child) { display: none !important; }`,
            `${a} > span.text_segment:has(> br:only-child) + span.text_segment:has(> br:only-child) { display: none !important; }`,

            // ── <p> 内部的连续 <br>（段内空行） ──
            // 保留第一个 br（换行），隐藏紧跟的第二个（空行）
            `${a} p br + br { display: none !important; }`,
            `${a} p br + span.text_segment:has(> br:only-child) { display: none !important; }`,
            `${a} p span.text_segment:has(> br:only-child) + span.text_segment:has(> br:only-child) { display: none !important; }`,
        ]);

        style.textContent = rules.join('\n');
        document.head.appendChild(style);
        console.log(TAG, '✓ CSS injected');
    }

    // =====================================================================
    //  工具：DOM 判断
    // =====================================================================

    const BLOCK_TAGS = new Set([
        'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
        'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'TABLE',
        'HR', 'FIGURE', 'DETAILS', 'SUMMARY', 'SECTION', 'ARTICLE',
    ]);

    const isBlock = (n) => n?.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(n.tagName);
    const isWS = (n) => n?.nodeType === Node.TEXT_NODE && /^\s*$/.test(n.textContent);

    function isEmptyP(n) {
        if (n?.nodeType !== Node.ELEMENT_NODE || n.tagName !== 'P') return false;
        const h = n.innerHTML.trim();
        return h === '' || h === '<br>' || /^(\s|&nbsp;)*$/.test(h);
    }

    function significantSibling(node, dir) {
        const prop = dir === 'prev' ? 'previousSibling' : 'nextSibling';
        let s = node[prop];
        while (s && isWS(s)) s = s[prop];
        return s;
    }

    /** 判断节点是否是 <br>（裸的或被 span 包裹的） */
    function isBrLike(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
        if (node.tagName === 'BR') return true;
        if (node.tagName === 'SPAN' && node.children.length === 1 &&
            node.children[0].tagName === 'BR' && node.textContent.trim() === '') {
            return true;
        }
        return false;
    }

    // =====================================================================
    //  功能 1：DOM 清理（仅在生成结束后调用）
    // =====================================================================

    const CONTAINER_TAGS = new Set([
        'DIV', 'DETAILS', 'SECTION', 'ARTICLE', 'ASIDE', 'MAIN',
        'FOOTER', 'HEADER', 'FIGURE', 'FIGCAPTION', 'SUMMARY',
        'BLOCKQUOTE', 'NAV', 'LI',
    ]);

    /**
     * 递归移除块级元素间的空行节点（<br> 和空 <p>）。
     * 只处理容器的直接子节点层级，不进入 <p> 内部。
     * <p> 内部的 <br> 是有意义的段落内换行，不能删。
     */
    function cleanBlockGaps(container) {
        if (!container) return false;
        let dirty = false;

        for (const node of Array.from(container.childNodes)) {
            const isEl = node.nodeType === Node.ELEMENT_NODE;
            const isBR = isEl && node.tagName === 'BR';
            const isEP = isEmptyP(node);

            if (isBR || isEP) {
                const prev = significantSibling(node, 'prev');
                const next = significantSibling(node, 'next');

                if ((prev === null || isBlock(prev)) && (next === null || isBlock(next))) {
                    node.remove();
                    dirty = true;
                }
            } else if (isEl && CONTAINER_TAGS.has(node.tagName)) {
                // 递归进入容器（但不进入 P、PRE 等内容元素）
                if (cleanBlockGaps(node)) dirty = true;
            }
        }
        return dirty;
    }

    /**
     * 移除连续 <br> 中多余的那些（保留第一个作为换行，删掉后续的空行）。
     * 对容器自身的子节点 + 所有 <p>/<li> 内部都执行。
     * 递归进入容器类子元素。
     */
    function cleanConsecutiveBr(container) {
        if (!container) return;

        // 处理容器自身的直接子节点
        _stripConsecutiveBr(container);

        // 处理 <p> 和 <li> 内部的连续 br
        const inners = container.querySelectorAll('p, li');
        for (const el of inners) {
            _stripConsecutiveBr(el);
        }
    }

    /** 在给定元素的直接子节点中，保留第一个 br，删掉连续后续的 */
    function _stripConsecutiveBr(el) {
        const children = Array.from(el.childNodes);
        let prevWasBr = false;

        for (const child of children) {
            if (isBrLike(child)) {
                if (prevWasBr) {
                    child.remove();
                } else {
                    prevWasBr = true;
                }
            } else if (isWS(child)) {
                // 空白文本不重置标记
            } else {
                prevWasBr = false;
            }
        }
    }

    // =====================================================================
    //  功能 3：段首全角空格缩进（仅在生成结束后执行）
    // =====================================================================

    const INDENT = '\u3000\u3000';

    function findFirstTextNode(el) {
        for (const child of el.childNodes) {
            if (child.nodeType === Node.TEXT_NODE && child.textContent.trim() !== '') {
                return child;
            }
            if (child.nodeType === Node.ELEMENT_NODE) {
                if (child.tagName === 'BR') continue;
                const found = findFirstTextNode(child);
                if (found) return found;
            }
        }
        return null;
    }

    /** 对单个文本节点执行缩进（如果还没有的话） */
    function _applyIndent(textNode) {
        if (!textNode || textNode.textContent.trim() === '') return;
        if (textNode.textContent.startsWith(INDENT)) return;
        const trimmed = textNode.textContent.replace(/^[\u3000\u0020\u00A0\t]+/, '');
        textNode.textContent = INDENT + trimmed;
    }

    function ensureIndent(container) {
        if (!container) return;
        const paragraphs = container.querySelectorAll('p');
        for (const p of paragraphs) {
            if (isEmptyP(p)) continue;
            if (p.closest('pre, blockquote, li, ul, ol')) continue;

            // 1. 段首缩进
            const firstText = findFirstTextNode(p);
            _applyIndent(firstText);

            // 2. <p> 内部每个 <br> 后面的"逻辑段落"也要缩进
            //    （正文可能是一个大 <p> 内用 <br> 分段）
            for (const child of Array.from(p.childNodes)) {
                if (!isBrLike(child)) continue;

                // 从 br 后面找第一个有文本的兄弟节点
                let sibling = child.nextSibling;
                while (sibling && isWS(sibling)) {
                    sibling = sibling.nextSibling;
                }
                if (!sibling) continue;

                const textNode = (sibling.nodeType === Node.TEXT_NODE)
                    ? sibling
                    : findFirstTextNode(sibling);
                _applyIndent(textNode);
            }
        }
    }

    // =====================================================================
    //  最终清扫：生成结束后一次性执行
    // =====================================================================

    function finalCleanup() {
        const lastMes = document.querySelector('#chat .last_mes');
        if (!lastMes) return;

        const targets = lastMes.querySelectorAll(TARGET_SELECTOR);
        for (const target of targets) {
            cleanBlockGaps(target);
            cleanConsecutiveBr(target);
            ensureIndent(target);
        }
        console.log(TAG, '✓ Final cleanup done');
    }

    // =====================================================================
    //  功能 2：Swipe 滚动位置锁定
    // =====================================================================

    function installSwipeFix() {
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('.swipe_left, .swipe_right');
            if (!btn) return;

            const chat = document.getElementById('chat');
            if (!chat) return;

            const saved = chat.scrollTop;
            if (saved <= 0) return;

            const THRESHOLD = 100;
            const checkpoints = [0, 50, 100, 200, 350, 500];

            checkpoints.forEach((ms) => {
                setTimeout(() => {
                    if (Math.abs(chat.scrollTop - saved) > THRESHOLD) {
                        chat.scrollTop = saved;
                    }
                }, ms);
            });
        }, true);

        console.log(TAG, '✓ Swipe scroll-lock installed');
    }

    // =====================================================================
    //  初始化
    // =====================================================================

    function init() {
        let ctx;
        try { ctx = SillyTavern.getContext(); } catch (_) { /* 尚未就绪 */ }

        if (!ctx?.eventSource || !ctx?.event_types) {
            setTimeout(init, 1500);
            return;
        }

        console.log(TAG, '✓ SillyTavern API ready — 开始挂载');

        injectCSS();
        installSwipeFix();

        ctx.eventSource.on(ctx.event_types.GENERATION_ENDED, () => {
            setTimeout(finalCleanup, 300);
        });

        ctx.eventSource.on(ctx.event_types.CHAT_CHANGED, () => {
            injectCSS();
        });
    }

    if (document.readyState === 'complete') {
        setTimeout(init, 2000);
    } else {
        window.addEventListener('load', () => setTimeout(init, 2000));
    }
})();