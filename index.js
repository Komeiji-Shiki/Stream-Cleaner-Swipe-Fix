/**
 * Stream Cleaner & Swipe Fix
 * ──────────────────────────
 * 功能1：消除段落间多余空行（流式期间 STREAM_TOKEN_RECEIVED + rAF 节流标记，结束后 DOM 清理）
 * 功能2：Swipe左右切换回复后保持滚动位置，不再跳到顶部
 *
 * v2.2 — 段首缩进改为纯 CSS text-indent（不再受 ST trim() 影响）
 *         流式标记改用 STREAM_TOKEN_RECEIVED 事件驱动
 *         finalCleanup 防重入
 *
 * @author 灰魂×主人
 */
(function () {
    'use strict';

    const TAG = '[StreamCleaner]';

    const TARGET_SELECTOR = '.mes_text, .mes_reasoning';
    const HIDDEN_CLASS = 'sc-hidden';

    // =====================================================================
    //  CSS：隐藏标记 + 段首缩进（纯 CSS，不受 ST trim 影响）
    // =====================================================================

    const STYLE_ID = 'stream-cleaner-css';

    function injectCSS() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `.${HIDDEN_CLASS} { display: none !important; }`;
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
        if (node.tagName === 'BR') {
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
    //  STREAM_TOKEN_RECEIVED 事件驱动 + requestAnimationFrame 节流
    // =====================================================================

    let rafId = 0;
    let isStreamActive = false;

    function streamMark() {
        const lastMes = document.querySelector('#chat .last_mes');
        if (!lastMes) return;

        const targets = lastMes.querySelectorAll(TARGET_SELECTOR);
        for (const target of targets) {
            unhideAll(target);
            markBlockGaps(target);
            markConsecutiveBr(target);
        }
    }

    /** 每个 token 到达时由事件触发，rAF 节流 */
    function onStreamToken() {
        if (!isStreamActive) return;
        if (rafId) return;
        rafId = requestAnimationFrame(() => {
            rafId = 0;
            streamMark();
        });
    }

    function cancelPendingRAF() {
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
    //  最终清扫：停止流式标记 → 清标记 → remove
    //  防重入：GENERATION_ENDED 与 GENERATION_STOPPED 可能都触发
    // =====================================================================

    let cleanupDone = false;

    function finalCleanup() {
        isStreamActive = false;
        cancelPendingRAF();

        if (cleanupDone) return;
        cleanupDone = true;

        const lastMes = document.querySelector('#chat .last_mes');
        if (!lastMes) return;

        unhideAll(lastMes);

        const targets = lastMes.querySelectorAll(TARGET_SELECTOR);
        for (const target of targets) {
            cleanBlockGaps(target);
            cleanConsecutiveBr(target);
            ensureIndent(target);
        }
        console.log(TAG, '✓ Final cleanup done');
    }

    // =====================================================================
    //  功能 3：段首全角空格缩进
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

    /** 段级 textContent 检测，避免子节点拆分导致误判 */
    function paragraphAlreadyIndented(p) {
        const tc = p.textContent;
        if (!tc || !tc.trim()) return true;
        return /^[\u3000]/.test(tc);
    }

    function ensureIndent(container) {
        if (!container) return;
        const paragraphs = container.querySelectorAll('p');
        for (const p of paragraphs) {
            if (isEmptyP(p)) continue;
            if (p.closest('pre, blockquote, li, ul, ol')) continue;
            if (paragraphAlreadyIndented(p)) continue;

            const firstText = findFirstTextNode(p);
            if (!firstText) continue;

            const trimmed = firstText.textContent.replace(/^[\u3000\u0020\u00A0\t]+/, '');
            firstText.textContent = INDENT + trimmed;
        }
    }

    // =====================================================================
    //  全局清理：切换聊天 / 编辑保存后对消息执行空行清理 + 缩进
    // =====================================================================

    function cleanupAllMessages() {
        const allMes = document.querySelectorAll('#chat .mes');
        if (!allMes.length) return;

        for (const mes of allMes) {
            const targets = mes.querySelectorAll(TARGET_SELECTOR);
            for (const target of targets) {
                cleanBlockGaps(target);
                cleanConsecutiveBr(target);
                ensureIndent(target);
            }
        }
        console.log(TAG, `✓ All messages cleaned (${allMes.length} messages)`);
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

        console.log(TAG, '✓ SillyTavern API ready — 开始挂载 (v2.2 事件驱动 + CSS 缩进方案)');

        injectCSS();
        installSwipeFix();

        // 生成开始 → 激活流式标记
        ctx.eventSource.on(ctx.event_types.GENERATION_STARTED, () => {
            isStreamActive = true;
            cleanupDone = false;
            console.log(TAG, '▶ Stream marking activated');
        });

        // 流式 token 到达 → rAF 节流标记空行
        if (ctx.event_types.STREAM_TOKEN_RECEIVED) {
            ctx.eventSource.on(ctx.event_types.STREAM_TOKEN_RECEIVED, onStreamToken);
        }

        // 消息编辑完成 → 对该消息重新执行空行清理
        ctx.eventSource.on(ctx.event_types.MESSAGE_EDITED, (messageId) => {
            setTimeout(() => {
                const mesEl = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
                if (!mesEl) return;
                const targets = mesEl.querySelectorAll(TARGET_SELECTOR);
                for (const target of targets) {
                    cleanBlockGaps(target);
                    cleanConsecutiveBr(target);
                    ensureIndent(target);
                }
                console.log(TAG, `✓ Post-edit cleanup for message #${messageId}`);
            }, 100);
        });

        // 生成结束 → 最终清理（覆盖正常结束 + 用户中止两种情况）
        ctx.eventSource.on(ctx.event_types.GENERATION_ENDED, () => {
            setTimeout(finalCleanup, 300);
        });
        ctx.eventSource.on(ctx.event_types.GENERATION_STOPPED, () => {
            setTimeout(finalCleanup, 300);
        });

        ctx.eventSource.on(ctx.event_types.CHAT_CHANGED, () => {
            isStreamActive = false;
            cancelPendingRAF();
            cleanupDone = false;
            injectCSS();

            // 切换聊天后，对所有消息执行空行清理
            setTimeout(cleanupAllMessages, 500);
        });

        // 初始加载：立即对当前聊天执行一次清理（因为 CHAT_CHANGED 可能在 init 之前已触发）
        setTimeout(cleanupAllMessages, 500);
    }

    if (document.readyState === 'complete') {
        setTimeout(init, 2000);
    } else {
        window.addEventListener('load', () => setTimeout(init, 2000));
    }
})();