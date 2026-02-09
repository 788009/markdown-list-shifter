import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand('markdown-list-shifter.toggleListType', async () => { // 注意这里加了 async
        const editor = vscode.window.activeTextEditor;
        if (!editor) { return; }

        const config = vscode.workspace.getConfiguration('markdown-list-shifter');
        const unorderedMarker = config.get<string>('defaultUnorderedMarker', '-');

        const document = editor.document;
        const selection = editor.selection;
        const currentLineIndex = selection.active.line;
        const currentLineText = document.lineAt(currentLineIndex).text;

        // 正则定义
        // Group 1: 缩进, Group 2: 标记(1. 或 - ), Group 3: 内容
        const orderedRegex = /^(\s*)(\d+\.\s+)(.*)/;
        const unorderedRegex = /^(\s*)([-*+]\s+)(.*)/;
        
        // 这是一个通用的正则，用于计算前缀长度
        const listRegex = /^(\s*)(\d+\.\s+|[-*+]\s+)(.*)/;

        let targetType: 'toOrdered' | 'toUnordered';
        let targetIndent = '';

        // 1. 确定转换方向
        if (orderedRegex.test(currentLineText)) {
            targetType = 'toUnordered';
            targetIndent = currentLineText.match(orderedRegex)![1];
        } else if (unorderedRegex.test(currentLineText)) {
            targetType = 'toOrdered';
            targetIndent = currentLineText.match(unorderedRegex)![1];
        } else {
            return;
        }

        // --- 光标位置计算准备 (Cursor Logic Part 1) ---
        // 我们需要计算光标相对于“内容”的偏移量。
        // 例如 "1. |abc"，光标在 a 前面。前缀 "1. " 长度为 3，光标在 col 3。相对偏移为 0。
        // 变成 "- |abc"，前缀 "- " 长度为 2。新光标位置应为 2 + 0 = 2。
        
        const activeCursor = selection.active; // 获取当前活动光标
        let cursorOffsetFromContent = 0;
        const activeLineMatch = currentLineText.match(listRegex);
        
        if (activeLineMatch) {
            // Group 1 (缩进) + Group 2 (标记) 的长度 = 内容起始前的总长度
            const oldPrefixLength = activeLineMatch[1].length + activeLineMatch[2].length;
            // 计算光标距离内容起点的偏移（如果光标在标记上，这个值可能是负数，我们取 0 保证光标吸附到内容开头）
            cursorOffsetFromContent = Math.max(0, activeCursor.character - oldPrefixLength);
        }
        // -------------------------------------------

        // 2. 收集需要修改的行 (Scanner Logic)
        const linesToModify: number[] = [];
        
        // 向上扫描
        for (let i = currentLineIndex; i >= 0; i--) {
            const line = document.lineAt(i);
            const text = line.text;
            if (!text.trim()) break;
            const lineIndent = (text.match(/^(\s*)/) || ['', ''])[1];

            if (lineIndent.length < targetIndent.length) break;
            if (lineIndent.length > targetIndent.length) continue;

            if (orderedRegex.test(text) || unorderedRegex.test(text)) {
                linesToModify.unshift(i);
            } else {
                break;
            }
        }

        // 向下扫描
        for (let i = currentLineIndex + 1; i < document.lineCount; i++) {
            const line = document.lineAt(i);
            const text = line.text;
            if (!text.trim()) break;
            const lineIndent = (text.match(/^(\s*)/) || ['', ''])[1];

            if (lineIndent.length < targetIndent.length) break;
            if (lineIndent.length > targetIndent.length) continue;

            if (orderedRegex.test(text) || unorderedRegex.test(text)) {
                linesToModify.push(i);
            } else {
                break;
            }
        }

        // 3. 执行编辑并追踪新光标位置
        let newCursorPos: vscode.Position | null = null;

        await editor.edit(editBuilder => { // 使用 await 等待编辑完成
            let orderCounter = 1;

            for (const lineIndex of linesToModify) {
                const line = document.lineAt(lineIndex);
                const text = line.text;
                let newText = '';
                let content = '';

                // 提取内容
                if (orderedRegex.test(text)) {
                    content = text.match(orderedRegex)![3];
                } else if (unorderedRegex.test(text)) {
                    content = text.match(unorderedRegex)![3];
                }

                // 构建新文本
                let newPrefix = '';
                if (targetType === 'toOrdered') {
                    newPrefix = `${targetIndent}${orderCounter}. `;
                    newText = `${newPrefix}${content}`;
                    orderCounter++;
                } else {
                    newPrefix = `${targetIndent}${unorderedMarker} `;
                    newText = `${newPrefix}${content}`;
                }

                // --- 光标位置计算核心 (Cursor Logic Part 2) ---
                // 如果当前循环处理的行正是光标所在的行，我们计算新的光标位置
                if (lineIndex === activeCursor.line) {
                    const newPrefixLength = newPrefix.length;
                    const newCharacterIndex = newPrefixLength + cursorOffsetFromContent;
                    newCursorPos = new vscode.Position(activeCursor.line, newCharacterIndex);
                }
                // -------------------------------------------

                editBuilder.replace(line.range, newText);
            }
        });

        // 4. 重设光标 (Apply New Cursor)
        if (newCursorPos) {
            editor.selection = new vscode.Selection(newCursorPos, newCursorPos);
            // 确保光标在视野内
            editor.revealRange(new vscode.Range(newCursorPos, newCursorPos)); 
        }
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {}