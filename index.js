/**
 * Stream Cleaner & Swipe Fix
 * ──────────────────────────
 * 功能1：流式输出时实时清除段落间多余空行（<br>、空<p>等）
 * 功能2：Swipe左右切换回复后保持滚动位置，不再跳到顶部
 *
 * @author 灰魂×主人
 */
(function () {
    'use strict';

    const TAG = '[StreamCleaner]';

    // =====================================================================
    //  工具：DOM 判断
    // =====================================================================

    const BLOCK_TAGS = new Set([
        'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
        'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'TABLE',
        'HR', 'FIGURE', 'DETAILS', 'SUMMARY', 'SECTION', 'ARTICLE',
    ]);

    /** 是否为块级元素 */
    const isBlock = (n) => n?.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has(n.tagName);

    /** 是否为纯空白文本节点 */
    const isWS = (n) => n?.nodeType === Node.TEXT_NODE && /^\s*$/.test(n.textContent);

    /** 是否为空段落（<p></p> / <p><br></p> / <p>&nbsp;</p>） */
    function isEmptyP(n) {
        if (n?.nodeType !== Node.ELEMENT_NODE || n.tagName !== 'P') return false;
        const h = n.innerHTML.trim();
        return h === '' || h === '<br>' || /^(\s|&nbsp;)*$/.test(h);
    }

    /** 跳过空白文本，找到有意义的兄弟节点 */
    function significantSibling(node, dir) {
        const prop = dir === 'prev' ? 'previousSibling' : 'nextSibling';
        let s = node[prop];
        while (s && isWS(s)) s = s[prop];
        return s;
    }

    // =====================================================================
    //  功能 1：清除段落间空行
    // =====================================================================

    /**
     * 扫描容器的**直接子节点**，移除夹在两个块级元素之间的 <br> 和空 <p>。
     * 返回是否有改动。
     */
    function cleanBlanks(container) {
        if (!container) return false;
        let dirty = false;

        // 快照后遍历，避免 live NodeList 的索引偏移
        for (const node of Array.from(container.childNodes)) {
            const isBR = node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR';
            const isEP = isEmptyP(node);
            if (!isBR && !isEP) continue;

            const prev = significantSibling(node, 'prev');
            const next = significantSibling(node, 'next');

            // 前后都是块级（或已到边界）→ 这个空行是多余的
            if ((prev === null || isBlock(prev)) && (next === null || isBlock(next))) {
                node.remove();
                dirty = true;
            }
        }
        return dirty;
    }

    // —— MutationObserver 相关 ——

    let chatObserver = null;
    let pendingRAF = null;

    function scheduledClean() {
        pendingRAF = null;
        const mesText = document.querySelector('#chat .last_mes .mes_text');
        if (mesText) cleanBlanks(mesText);
    }

    function startObserving() {
        const chat = document.getElementById('chat');
        if (!chat || chatObserver) return;

        chatObserver = new MutationObserver(() => {
            // 合并同一帧内的多次 mutation
            if (pendingRAF) return;
            pendingRAF = requestAnimationFrame(scheduledClean);
        });

        chatObserver.observe(chat, {
            childList: true,
            subtree: true,
            characterData: true,
        });

        console.log(TAG, '✓ MutationObserver → #chat');
    }

    function stopObserving() {
        if (chatObserver) {
            chatObserver.disconnect();
            chatObserver = null;
        }
        if (pendingRAF) {
            cancelAnimationFrame(pendingRAF);
            pendingRAF = null;
        }
    }

    // =====================================================================
    //  功能 2：Swipe 滚动位置锁定
    // =====================================================================

    function installSwipeFix() {
        // capture 阶段，在酒馆自己的 handler 之前记录滚动位置
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('.swipe_left, .swipe_right');
            if (!btn) return;

            const chat = document.getElementById('chat');
            if (!chat) return;

            const saved = chat.scrollTop;
            if (saved <= 0) return; // 本来就在顶部，无需修复

            // 在后续多个时间点检查并恢复——只在偏移超过阈值时才修正
            // 这样不会干扰用户主动的滚动
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

        // 启动观察 & Swipe 修复
        startObserving();
        installSwipeFix();

        // 聊天切换时重新挂载观察器
        ctx.eventSource.on(ctx.event_types.CHAT_CHANGED, () => {
            stopObserving();
            setTimeout(startObserving, 300);
        });

        // 生成结束后做一次最终清扫（流式残留的最后机会）
        ctx.eventSource.on(ctx.event_types.GENERATION_ENDED, () => {
            setTimeout(() => {
                const mesText = document.querySelector('#chat .last_mes .mes_text');
                if (mesText) cleanBlanks(mesText);
            }, 200);
        });
    }

    // 入口
    if (document.readyState === 'complete') {
        setTimeout(init, 2000);
    } else {
        window.addEventListener('load', () => setTimeout(init, 2000));
    }
})();