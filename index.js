/**
 * Stream Cleaner & Swipe Fix
 * ──────────────────────────
 * 功能1：消除段落间多余空行（流式期间 rAF 节流标记，结束后 DOM 清理）
 * 功能2：Swipe左右切换回复后保持滚动位置，不再跳到顶部
 * 功能3：段首自动补两个全角空格缩进（仅生成结束后执行）
 *
 * v2.0 — 完全移除 :has() CSS 选择器，改用 MutationObserver + rAF 方案
 *         消除流式期间的样式重计算瓶颈
 *
 * @author 灰魂×主人
 */
(function () {
    'use strict';

    const TAG = '[StreamCleaner]';

    const TARGET_SELECTOR = '.mes_text, .mes_reasoning';
    const HIDDEN_CLASS = 'sc-hidden';

    // =====================================================================
    //  CSS：只需要一条极简规则，零选择器开销
    // =====================================================================

    const STYLE_ID = 'stream-cleaner-css';

    function injectCSS() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `.${HIDDEN_CLASS} { display: none !important; }`;
        document.head.appendChild(style);
        console.log(TAG, '✓ CSS injected (minimal — no :has())');
    }

    // =====================================================================
    //  工具：DOM 判断
    // =====================================================================

    const BLOCK_TAGS = new Set([
        'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
        'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'TABLE',
        'HR', 'FIGURE', 'DETAILS', 'SUMMARY', 'SECTION', 'ARTICLE',
    ]);

    const CONTAINER_TAGS = new Set([
        'DIV', 'DETAILS', 'SECTION', 'ARTICLE', 'ASIDE', 'MAIN',
        'FOOTER', 'HEADER', 'FIGURE', 'FIGCAPTION', 'SUMMARY',
        'BLOCKQUOTE', 'NAV', 'LI',
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
        while (s && (isWS(s) || s.classList?.contains(HIDDEN_CLASS))) s = s[prop];
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

    /** 隐藏一个元素（class 标记） */
    function hide(node) {
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        // BR 没有 classList，需要用 wrapper 或 inline style
        if (node.tagName === 'BR') {
            // 为裸 BR 添加 data 标记 + inline style（BR 的 classList 有效但保险起见双重保障）
            node.setAttribute('data-sc-hidden', '');
            node.style.display = 'none';
        } else {
            node.classList.add(HIDDEN_CLASS);
        }
    }

    /** 取消隐藏 */
    function unhideAll(root) {
        root.querySelectorAll(`.${HIDDEN_CLASS}`).forEach(el => {
            el.classList.remove(HIDDEN_CLASS);
        });
        root.querySelectorAll('[data-sc-hidden]').forEach(br => {
            br.removeAttribute('data-sc-hidden');
            br.style.removeProperty('display');
        });
    }

    // =====================================================================
    //  流式期间：轻量标记（加 class / inline style，不 remove）
    // =====================================================================

    /** 标记块级元素间的空行 */
    function markBlockGaps(container) {
        if (!container) return;

        for (const node of Array.from(container.childNodes)) {
            const isEl = node.nodeType === Node.ELEMENT_NODE;
            if (!isEl) continue;

            const isBR = node.tagName === 'BR';
            const isEP = isEmptyP(node);

            if (isBR || isEP) {
                const prev = significantSibling(node, 'prev');
                const next = significantSibling(node, 'next');
                const shouldHide = (prev === null || isBlock(prev)) &&
                                   (next === null || isBlock(next));
                if (shouldHide) {
                    hide(node);
                }
            } else if (CONTAINER_TAGS.has(node.tagName)) {
                markBlockGaps(node);
            }
        }
    }

    /** 标记连续 br 中多余的 */
    function markConsecutiveBr(container) {
        if (!container) return;
        _markConsecutiveBrIn(container);
        const inners = container.querySelectorAll('p, li');
        for (const el of inners) {
            _markConsecutiveBrIn(el);
        }
    }

    function _markConsecutiveBrIn(el) {
        let prevWasBr = false;
        for (const child of Array.from(el.childNodes)) {
            if (isBrLike(child)) {
                if (prevWasBr) {
                    hide(child);
                } else {
                    prevWasBr = true;
                }
            } else if (isWS(child)) {
                // 空白文本不重置
            } else {
                prevWasBr = false;
            }
        }
    }

    // =====================================================================
    //  MutationObserver + requestAnimationFrame 节流
    // =====================================================================

    let observer = null;
    let rafId = 0;

    function streamMark() {
        const lastMes = document.querySelector('#chat .last_mes');
        if (!lastMes) return;

        const targets = lastMes.querySelectorAll(TARGET_SELECTOR);
        for (const target of targets) {
            // 先清除之前的标记再重新标记（保证正确性）
            unhideAll(target);
            markBlockGaps(target);
            markConsecutiveBr(target);
        }
    }

    function onMutation() {
        if (rafId) return; // 已经有排队的帧，跳过
        rafId = requestAnimationFrame(() => {
            rafId = 0;
            streamMark();
        });
    }

    function startObserver() {
        stopObserver();

        // 延迟一帧，确保 ST 已更新 .last_mes
        requestAnimationFrame(() => {
            const lastMes = document.querySelector('#chat .last_mes');
            if (!lastMes) return;

            observer = new MutationObserver(onMutation);
            observer.observe(lastMes, { childList: true, subtree: true, characterData: true });
            console.log(TAG, '▶ Observer started (watching .last_mes only)');

            // 立即执行一次标记
            streamMark();
        });
    }

    function stopObserver() {
        if (observer) {
            observer.disconnect();
            observer = null;
        }
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = 0;
        }
    }

    // =====================================================================
    //  功能 1：DOM 清理（生成结束后真正 remove 节点）
    // =====================================================================

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
                if (cleanBlockGaps(node)) dirty = true;
            }
        }
        return dirty;
    }

    function cleanConsecutiveBr(container) {
        if (!container) return;
        _stripConsecutiveBr(container);
        const inners = container.querySelectorAll('p, li');
        for (const el of inners) {
            _stripConsecutiveBr(el);
        }
    }

    function _stripConsecutiveBr(el) {
        let prevWasBr = false;
        for (const child of Array.from(el.childNodes)) {
            if (isBrLike(child)) {
                if (prevWasBr) {
                    child.remove();
                } else {
                    prevWasBr = true;
                }
            } else if (isWS(child)) {
                // skip
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
            if (child.nodeType === Node.TEXT_NODE && child.textContent.trim() !== '') return child;
            if (child.nodeType === Node.ELEMENT_NODE) {
                if (child.tagName === 'BR') continue;
                const found = findFirstTextNode(child);
                if (found) return found;
            }
        }
        return null;
    }

    function ensureIndent(container) {
        if (!container) return;
        const paragraphs = container.querySelectorAll('p');
        for (const p of paragraphs) {
            if (isEmptyP(p)) continue;
            if (p.closest('pre, blockquote, li, ul, ol')) continue;

            const firstText = findFirstTextNode(p);
            if (!firstText) continue;
            if (firstText.textContent.startsWith(INDENT)) continue;

            const trimmed = firstText.textContent.replace(/^[\u3000\u0020\u00A0\t]+/, '');
            firstText.textContent = INDENT + trimmed;
        }
    }

    // =====================================================================
    //  最终清扫：停止 observer → 清标记 → remove → 缩进
    // =====================================================================

    function finalCleanup() {
        stopObserver();

        const lastMes = document.querySelector('#chat .last_mes');
        if (!lastMes) return;

        // 清除流式期间的所有隐藏标记
        unhideAll(lastMes);

        // 真正的 DOM 清理
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

        console.log(TAG, '✓ SillyTavern API ready — 开始挂载 (v2.0 rAF 方案)');

        injectCSS();
        installSwipeFix();

        // 生成开始 → 启动 observer
        ctx.eventSource.on(ctx.event_types.GENERATION_STARTED, () => {
            startObserver();
        });

        // 生成结束 → 最终清理（覆盖正常结束 + 用户中止两种情况）
        ctx.eventSource.on(ctx.event_types.GENERATION_ENDED, () => {
            setTimeout(finalCleanup, 300);
        });
        ctx.eventSource.on(ctx.event_types.GENERATION_STOPPED, () => {
            setTimeout(finalCleanup, 300);
        });

        ctx.eventSource.on(ctx.event_types.CHAT_CHANGED, () => {
            stopObserver();
            injectCSS();
        });
    }

    if (document.readyState === 'complete') {
        setTimeout(init, 2000);
    } else {
        window.addEventListener('load', () => setTimeout(init, 2000));
    }
})();