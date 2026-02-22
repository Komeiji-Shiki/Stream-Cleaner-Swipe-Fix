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
            // 空段落
            `${a} p:empty { display: none !important; }`,
            `${a} p:has(> br:only-child) { display: none !important; }`,
            // 连续 <br>
            `${a} br + br { display: none !important; }`,
            `${a} br + span.text_segment:has(> br:only-child) { display: none !important; }`,
            `${a} span.text_segment:has(> br:only-child) + span.text_segment:has(> br:only-child) { display: none !important; }`,
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

    /** 递归移除块级元素间的空行节点 */
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

    /** 移除段落/列表项内部连续 <br> 中多余的那些 */
    function cleanConsecutiveBr(container) {
        if (!container) return;
        // 处理 p 和 li 内部的连续 br
        const targets = container.querySelectorAll('p, li');
        for (const el of targets) {
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
                    // 跳过空白文本，不重置标记
                } else {
                    prevWasBr = false;
                }
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
    //  最终清扫：生成结束后一次性执行
    // =====================================================================

    function finalCleanup() {
        const lastMes = document.querySelector('#chat .last_mes');
        if (!lastMes) return;

        // 对正文和思维链都执行清理
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

        // 注入 CSS（立即生效，零闪烁）
        injectCSS();

        // Swipe 修复
        installSwipeFix();

        // 生成结束后做一次最终清扫
        ctx.eventSource.on(ctx.event_types.GENERATION_ENDED, () => {
            setTimeout(finalCleanup, 300);
        });

        // 聊天切换后确保 CSS 存在
        ctx.eventSource.on(ctx.event_types.CHAT_CHANGED, () => {
            injectCSS();
        });
    }

    // 入口
    if (document.readyState === 'complete') {
        setTimeout(init, 2000);
    } else {
        window.addEventListener('load', () => setTimeout(init, 2000));
    }
})();