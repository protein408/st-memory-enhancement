// absoluteRefresh.js
import { BASE, DERIVED, EDITOR, SYSTEM, USER } from '../../core/manager.js';
import { findTableStructureByIndex, convertOldTablesToNewSheets, executeTableEditActions, getTableEditTag } from "../../index.js";
import { insertRow, updateRow, deleteRow } from "../../core/table/oldTableActions.js";
import JSON5 from '../../utils/json5.min.mjs'
import { updateSystemMessageTableStatus } from "../renderer/tablePushToChat.js";
import { TableTwoStepSummary } from "./separateTableUpdate.js";
import { estimateTokenCount, handleCustomAPIRequest, handleMainAPIRequest } from "../settings/standaloneAPI.js";
import { profile_prompts } from "../../data/profile_prompts.js";
import { refreshContextView } from "../editor/chatSheetsDataView.js";
import { Form } from '../../components/formManager.js';
import { refreshRebuildTemplate } from "../settings/userExtensionSetting.js"

// 在파싱响应后添加验证
function validateActions(actions) {
    if (!Array.isArray(actions)) {
        console.error('작업 목록은 배열이어야 합니다');
        return false;
    }
    return actions.every(action => {
        // 필수 필드 검사
        if (!action.action || !['insert', 'update', 'delete'].includes(action.action.toLowerCase())) {
            console.error(`잘못된 작업 유형: ${action.action}`);
            return false;
        }
        if (typeof action.tableIndex !== 'number') {
            console.error(`tableIndex는 숫자여야 합니다: ${action.tableIndex}`);
            return false;
        }
        if (action.action !== 'insert' && typeof action.rowIndex !== 'number') {
            console.error(`rowIndex는 숫자여야 합니다: ${action.rowIndex}`);
            return false;
        }
        // data 필드 검사
        if (action.data && typeof action.data === 'object') {
            const invalidKeys = Object.keys(action.data).filter(k => !/^\d+$/.test(k));
            if (invalidKeys.length > 0) {
                console.error(`숫자가 아닌 키 발견: ${invalidKeys.join(', ')}`);
                return false;
            }
        }
        return true;
    });
}

function confirmTheOperationPerformed(content) {
    console.log('content:', content);
    return `
<div class="wide100p padding5 dataBankAttachments">
    <div class="refresh-title-bar">
        <h2 class="refresh-title"> 다음 작업을 확인해주세요 </h2>
        <div>

        </div>
    </div>
    <div id="tableRefresh" class="refresh-scroll-content">
        <div>
            <div class="operation-list-container"> ${content.map(table => {
        return `
<h3 class="operation-list-title">${table.tableName}</h3>
<div class="operation-list">
    <table class="tableDom sheet-table">
        <thead>
            <tr>
                ${table.columns.map(column => `<th>${column}</th>`).join('')}
            </tr>
        </thead>
        <tbody>
            ${table.content.map(row => `
            <tr>
                ${row.map(cell => `<td>${cell}</td>`).join('')}
            </tr>
            `).join('')}
        </tbody>
    </table>
</div>
<hr>
`;
    }).join('')}
            </div>
        </div>
    </div>
</div>

<style>
    .operation-list-title {
        text-align: left;
        margin-top: 10px;
    }
    .operation-list-container {
        display: flex;
        flex-wrap: wrap;
    }
    .operation-list {
        width: 100%;
        max-width: 100%;
        overflow: auto;
    }
</style>
`;
}



/**
 * 테이블 새로고침 유형 선택기 초기화
 * profile_prompts 객체에 따라 동적으로 드롭다운 선택기 옵션 생성
 */
export function initRefreshTypeSelector() {
    const $selector = $('#table_refresh_type_selector');
    if (!$selector.length) return;

    // 清空并重新添加选项
    $selector.empty();

    // 遍历profile_prompts对象，添加选项
    Object.entries(profile_prompts).forEach(([key, value]) => {
        const option = $('<option></option>')
            .attr('value', key)
            .text((() => {
                switch (value.type) {
                    case 'refresh':
                        return '**이전**' + (value.name || key);
                    case 'third_party':
                        return '**타사 작성자** ' + (value.name || key);
                    default:
                        return value.name || key;
                }
            })());
        $selector.append(option);
    });

    // 如果没有选项，添加默认选项
    if ($selector.children().length === 0) {
        $selector.append($('<option></option>').attr('value', 'rebuild_base').text('~~~이 옵션이 보인다면 문제가 발생했습니다~~~~'));
    }

    console.log('테이블 새로고침 유형 선택기가 업데이트되었습니다');

    // // 检查现有选项是否与profile_prompts一致
    // let needsUpdate = false;
    // const currentOptions = $selector.find('option').map(function() {
    //     return {
    //         value: $(this).val(),
    //         text: $(this).text()
    //     };
    // }).get();

    // // 检查选项数量是否一致
    // if (currentOptions.length !== Object.keys(profile_prompts).length) {
    //     needsUpdate = true;
    // } else {
    //     // 检查每个选项的值和文本是否一致
    //     Object.entries(profile_prompts).forEach(([key, value]) => {
    //         const currentOption = currentOptions.find(opt => opt.value === key);
    //         if (!currentOption ||
    //             currentOption.text !== ((value.type=='refresh'? '**이전** ':'')+value.name|| key)) {
    //             needsUpdate = true;
    //         }
    //     });
    // }

    // // 不匹配时清空并重新添加选项
    // if (needsUpdate) {
    //     $selector.empty();

    //     // 遍历profile_prompts对象，添加选项
    //     Object.entries(profile_prompts).forEach(([key, value]) => {
    //         const option = $('<option></option>')
    //             .attr('value', key)
    //             .text((value.type=='refresh'? '**旧** ':'')+value.name|| key);
    //         $selector.append(option);
    //     });

    //     // 如果没有选项，添加默认选项
    //     if ($selector.children().length === 0) {
    //         $selector.append($('<option></option>').attr('value', 'rebuild_base').text('~~~看到这个选项说明出问题了~~~~'));
    //     }

    //     console.log('테이블새로고침类型选择器已更新');
}



/**
 * 根据选择的새로고침类型获取对应的提示模板并调用rebuildTableActions
 * @param {string} templateName 프롬프트 템플릿 이름
 * @param {string} additionalPrompt 추가 프롬프트 내용
 * @param {boolean} force 강제 새로고침 여부, 확인 대화 상자 표시 안 함
 * @param {boolean} isSilentUpdate 자동 업데이트 여부, 작업 확인 표시 안 함
 * @param {string} chatToBeUsed 사용할 채팅 기록 (비어있으면 최신 채팅 기록 사용)
 */
export async function getPromptAndRebuildTable(templateName = '', additionalPrompt, force, isSilentUpdate = USER.tableBaseSetting.bool_silent_refresh, chatToBeUsed = '') {
    let r = '';
    try {
        // 根据提示模板类型选择不同的테이블处理函数
        // const force = $('#bool_force_refresh').prop('checked');
        r = await rebuildTableActions(force || true, isSilentUpdate, chatToBeUsed);
        return r;
    } catch (error) {
        console.error('获取提示模板실패:', error);
        EDITOR.error(`프롬프트 템플릿 가져오기 실패: ${error.message}`);
    }
}

/**
 * 重新生成完整테이블
 * @param {*} force 是否强制새로고침
 * @param {*} silentUpdate  是否静默更新
 * @param chatToBeUsed
 * @returns
 */
export async function rebuildTableActions(force = false, silentUpdate = USER.tableBaseSetting.bool_silent_refresh, chatToBeUsed = '') {
    let r = '';
    if (!SYSTEM.lazy('rebuildTableActions', 1000)) return;

    // 如果不是强制새로고침，계속할지 확인
    // if (!force) {
    //     // 显示配置状态
    //     const tableRefreshPopup = getRefreshTableConfigStatus(1);
    //     const confirmation = await EDITOR.callGenericPopup(tableRefreshPopup, EDITOR.POPUP_TYPE.CONFIRM, '', { okButton: "계속하기", cancelButton: "취소" });
    //     if (!confirmation) return;
    // }

    // 开始重新生成完整테이블
    console.log('전체 테이블 재생성 시작');
    const isUseMainAPI = $('#use_main_api').prop('checked');

    try {
        const { piece } = BASE.getLastSheetsPiece();
        if (!piece) {
            throw new Error('findLastestTableData가 유효한 테이블 데이터를 반환하지 않았습니다');
        }
        const latestTables = BASE.hashSheetsToSheets(piece.hash_sheets).filter(sheet => sheet.enable);
        DERIVED.any.waitingTable = latestTables;

        const oldTable = sheetsToTables(latestTables)
        let originText = tablesToString(latestTables);

        // 테이블 헤더 정보 추출
        const tableHeadersOnly = oldTable.map((table, index) => {
            let name = `Table ${index + 1}`;
            if (typeof table.tableName === 'string' && table.tableName) {
                name = table.tableName;
            }
            let headers = [];
            if (Array.isArray(table.headers) && table.headers.length > 0) {
                headers = table.headers;
            } else if (Array.isArray(table.columns) && table.columns.length > 0) {
                headers = table.columns;
            }
            return {
                tableName: name,
                headers: headers
            };
        });
        const tableHeadersJson = JSON.stringify(tableHeadersOnly);
        console.log('헤더 데이터 (JSON):', tableHeadersJson);

        console.log('정리 - 최신 테이블 데이터:', originText);

        // 获取最近clear_up_stairs条聊天记录
        const chat = USER.getContext().chat;
        const lastChats = chatToBeUsed === '' ? await getRecentChatHistory(chat,
            USER.tableBaseSetting.clear_up_stairs,
            USER.tableBaseSetting.ignore_user_sent,
            USER.tableBaseSetting.rebuild_token_limit_value
            // USER.tableBaseSetting.use_token_limit ? USER.tableBaseSetting.rebuild_token_limit_value : 0
        ) : chatToBeUsed;

        // 构建AI提示
        const select = USER.tableBaseSetting.lastSelectedTemplate ?? "rebuild_base"
        const template = select === "rebuild_base" ? {
            name: "rebuild_base",
            system_prompt: USER.tableBaseSetting.rebuild_default_system_message_template,
            user_prompt_begin: USER.tableBaseSetting.rebuild_default_message_template,
        } : USER.tableBaseSetting.rebuild_message_template_list[select]
        if (!template) {
            console.error('해당하는 프롬프트 템플릿을 찾을 수 없습니다. 설정을 확인해주세요', select, template);
            EDITOR.error('해당하는 프롬프트 템플릿을 찾을 수 없습니다. 설정을 확인해주세요');
            return;
        }
        let systemPrompt = template.system_prompt
        let userPrompt = template.user_prompt_begin;

        let parsedSystemPrompt

        try {
            parsedSystemPrompt = JSON5.parse(systemPrompt)
            console.log('파싱된 systemPrompt:', parsedSystemPrompt);
        } catch (error) {
            console.log("파싱 실패", error)
            parsedSystemPrompt = systemPrompt
        }

        const replacePrompt = (input) => {
            let output = input
            output = output.replace(/\$0/g, originText);
            output = output.replace(/\$1/g, lastChats);
            output = output.replace(/\$2/g, tableHeadersJson);
            output = output.replace(/\$3/g, DERIVED.any.additionalPrompt ?? '');
            return output
        }

        // systemPrompt에서 $0과 $1 필드를 검색하여 $0을 originText로, $1을 lastChats로 대체
        if (typeof parsedSystemPrompt === 'string') {
            parsedSystemPrompt = replacePrompt(parsedSystemPrompt);
        } else {
            parsedSystemPrompt = parsedSystemPrompt.map(mes => ({ ...mes, content: replacePrompt(mes.content) }))
        }


        // userPrompt에서 $0과 $1 필드를 검색하여 $0을 originText로, $1을 lastChats로, $2를 빈 헤더로 대체
        userPrompt = userPrompt.replace(/\$0/g, originText);
        userPrompt = userPrompt.replace(/\$1/g, lastChats);
        userPrompt = userPrompt.replace(/\$2/g, tableHeadersJson);
        userPrompt = userPrompt.replace(/\$3/g, DERIVED.any.additionalPrompt ?? '');

        console.log('systemPrompt:', parsedSystemPrompt);
        // console.log('userPrompt:', userPrompt);



        // 응답 내용 생성
        let rawContent;
        if (isUseMainAPI) {
            try {
                rawContent = await handleMainAPIRequest(parsedSystemPrompt, userPrompt);
                if (rawContent === 'suspended') {
                    EDITOR.info('작업이 취소되었습니다');
                    return
                }
            } catch (error) {
                EDITOR.clear();
                EDITOR.error('주 API 요청 오류: ' + error.message);
                console.error('주 API 요청 오류:', error);
            }
        }
        else {
            try {
                rawContent = await handleCustomAPIRequest(parsedSystemPrompt, userPrompt);
                if (rawContent === 'suspended') {
                    EDITOR.clear();
                    EDITOR.info('작업이 취소되었습니다');
                    return
                }
            } catch (error) {
                EDITOR.clear();
                EDITOR.error('사용자 정의 API 요청 오류: ' + error.message);
            }
        }
        console.log('rawContent:', rawContent);

        // rawContent가 유효한지 확인
        if (typeof rawContent !== 'string') {
            EDITOR.clear();
            EDITOR.error('API 응답 내용이 유효하지 않아 테이블 처리를 계속할 수 없습니다.');
            console.error('API 응답 내용이 유효하지 않음, rawContent:', rawContent);
            return;
        }

        if (!rawContent.trim()) {
            EDITOR.clear();
            EDITOR.error('API 응답 내용이 비어 있어 테이블 처리를 계속할 수 없습니다.');
            console.error('API 응답 내용이 비어 있음, rawContent:', rawContent);
            return;
        }

        const temp = USER.tableBaseSetting.rebuild_message_template_list[USER.tableBaseSetting.lastSelectedTemplate];
        if (temp && temp.parseType === 'text') {
            const previewHtml = `
                <div>
                    <div style="margin-bottom: 10px; display: flex; align-items: center;">
                        <span style="margin-right: 10px;">반환된 요약 결과입니다. 복사하여 사용해주세요</span>
                    </div>
                    <textarea id="rebuild_text_preview" rows="10" style="width: 100%">${rawContent}</textarea>
                </div>`;

            const popup = new EDITOR.Popup(previewHtml, EDITOR.POPUP_TYPE.TEXT, '', { wide: true });
            await popup.show()
            return
        }

        // 데이터 정제
        let cleanContentTable = fixTableFormat(rawContent);
        console.log('cleanContent:', cleanContentTable);

        // 테이블 다시 저장
        if (cleanContentTable) {
            try {
                // 데이터 형식 검증
                if (!Array.isArray(cleanContentTable)) {
                    throw new Error("생성된 새 테이블 데이터가 배열이 아닙니다");
                }
                // 변경사항 표시
                // TODO
                compareAndMarkChanges(oldTable, cleanContentTable);
                // console.log('compareAndMarkChanges 후의 cleanContent:', cleanContentTable);

                // 참조 문제 방지를 위한 깊은 복사
                const clonedTables = tableDataToTables(cleanContentTable);
                console.log('깊은 복사 후의 cleanContent:', clonedTables);

                // 제목 수정 방지
                clonedTables.forEach((table, index) => {
                    table.tableName = oldTable[index].tableName
                });

                // 자동 업데이트가 아닌 경우 작업 확인 표시
                if (!silentUpdate) {
                    // uniqueActions 내용을 사용자에게 보여주고 계속할지 확인
                    const confirmContent = confirmTheOperationPerformed(clonedTables);
                    const tableRefreshPopup = new EDITOR.Popup(confirmContent, EDITOR.POPUP_TYPE.TEXT, '', { okButton: "계속하기", cancelButton: "취소" });
                    EDITOR.clear();
                    await tableRefreshPopup.show();
                    if (!tableRefreshPopup.result) {
                        EDITOR.info('작업이 취소되었습니다');
                        return;
                    }
                }

                // 채팅 기록 업데이트
                const chat = USER.getContext().chat;
                const { piece } = USER.getChatPiece()
                if (piece) {
                    convertOldTablesToNewSheets(clonedTables, piece)
                    await USER.getContext().saveChat(); // 저장 완료 대기
                } else {
                    throw new Error("채팅 기록이 비어 있습니다");
                }

                // UI 새로고침
                const tableContainer = document.querySelector('#tableContainer');
                if (tableContainer) {
                    refreshContextView();
                    updateSystemMessageTableStatus();
                    EDITOR.success('테이블 생성 성공!');
                    r = 'success';
                } else {
                    // console.error("테이블을 새로고칠 수 없습니다: 컨테이너를 찾을 수 없습니다");
                    // EDITOR.error('테이블 생성 실패: 컨테이너를 찾을 수 없습니다');
                }
                return r;
            } catch (error) {
                console.error('테이블 저장 중 오류 발생:', error);
                EDITOR.error(`테이블 생성 실패: ${error.message}`);
            }
        } else {
            EDITOR.error("테이블 생성 저장 실패: 내용이 비어 있습니다");
        }

    } catch (e) {
        console.error('rebuildTableActions에서 오류 발생:', e);
        return;
    } finally {

    }
}

export async function refreshTableActions(force = false, silentUpdate = false, chatToBeUsed = '') {
    if (!SYSTEM.lazy('refreshTableActions', 1000)) return;

    // // 강제 새로고침이 아닌 경우 계속할지 확인
    // if (!force) {
    //     // 설정 상태 표시
    //     const tableRefreshPopup = getRefreshTableConfigStatus();
    //     const confirmation = await EDITOR.callGenericPopup(tableRefreshPopup, EDITOR.POPUP_TYPE.CONFIRM, '', { okButton: "계속하기", cancelButton: "취소" });
    //     if (!confirmation) return;
    // }

    // 테이블 정리 실행 시작
    const twoStepIsUseMainAPI = $('#step_by_step_use_main_api').prop('checked');

    try {
        const { piece } = BASE.getLastSheetsPiece();
        if (!piece) {
            throw new Error('findLastestTableData가 유효한 테이블 데이터를 반환하지 않았습니다');
        }
        const latestTables = BASE.hashSheetsToSheets(piece.hash_sheets);
        DERIVED.any.waitingTable = latestTables;

        let chat = USER.getContext().chat;
        let originText = '<테이블 내용>\n' + latestTables
            .map((table, index) => table.getTableText(index, ['title', 'node', 'headers', 'rows']))
            .join("\n");

        // 최근 clear_up_stairs개의 채팅 기록 가져오기
        const lastChats = chatToBeUsed === '' ? await getRecentChatHistory(chat, USER.tableBaseSetting.clear_up_stairs, USER.tableBaseSetting.ignore_user_sent) : chatToBeUsed;

        // AI 프롬프트 구성
        let systemPrompt = USER.tableBaseSetting.refresh_system_message_template;
        let userPrompt = USER.tableBaseSetting.refresh_user_message_template;

        // systemPrompt에서 $0과 $1 필드를 검색하여 $0을 originText로, $1을 lastChats로 대체
        systemPrompt = systemPrompt.replace(/\$0/g, originText);
        systemPrompt = systemPrompt.replace(/\$1/g, lastChats);

        // userPrompt에서 $0과 $1 필드를 검색하여 $0을 originText로, $1을 lastChats로 대체
        userPrompt = userPrompt.replace(/\$0/g, originText);
        userPrompt = userPrompt.replace(/\$1/g, lastChats);


        // 응답 내용 생성
        let rawContent;
        if (twoStepIsUseMainAPI) {
            try {
                rawContent = await handleMainAPIRequest(systemPrompt, userPrompt);
                if (rawContent === 'suspended') {
                    EDITOR.info('작업이 취소되었습니다');
                    return 'suspended'
                }
            } catch (error) {
                EDITOR.error('주 API 요청 오류: ' + error.message);
            }
        }
        else {
            try {
                rawContent = await handleCustomAPIRequest(systemPrompt, userPrompt);
                if (rawContent === 'suspended') {
                    EDITOR.info('작업이 취소되었습니다');
                    return 'suspended'
                }
            } catch (error) {
                EDITOR.error('사용자 정의 API 요청 오류: ' + error.message);
            }
        }

        // 데이터 정제
        let cleanContent = cleanApiResponse(rawContent);

        // 응답 내용 파싱
        let actions;
        try {
            // 데이터 정제 로직 강화
            cleanContent = cleanContent
                // 시간 형식 보호 (최우선 처리!!!!)
                .replace(/(?<!")(\d{1,2}:\d{2})(?!")/g, '"$1"') // 중복 처리 방지를 위해 부정적 전방/후방 탐색 사용
                // 키 이름 통일
                .replace(/"([a-zA-Z_]\w*)"\s*:/g, '"$1":') // 유효한 키 이름 형식만 처리
                // 끝 쉼표 수정
                .replace(/,\s*([}\]])/g, '$1')
                // 숫자 키 처리 (시간 처리 후 실행)
                .replace(/([{,]\s*)(\d+)(\s*:)/g, '$1"$2"$3')
                // 기타 처리
                .replace(/\\\//g, '/')
                .replace(/\/\/.*/g, ''); // 행 주석 제거

            // 안전성 검사
            if (!cleanContent || typeof cleanContent !== 'string') {
                throw new Error('유효하지 않은 응답 내용');
            }

            actions = JSON5.parse(cleanContent);
            if (!validateActions(actions)) {
                throw new Error('AI가 유효하지 않은 작업 형식을 반환했습니다');
            }
        } catch (parseError) {
            // 에러 위치 오류 처리 추가
            const position = parseError.position || 0;
            console.error('[파싱 오류] 상세 로그:', {
                rawContent: cleanContent,
                errorPosition: parseError.stack,
                previewText: cleanContent.slice(
                    Math.max(0, position - 50),
                    position + 50
                )
            });
            throw new Error(`JSON 파싱 실패: ${parseError.message}`);
        }
        console.log('정제된 내용:', cleanContent);

        // 중복 제거 및 삭제 작업 순서 보장
        let uniqueActions = [];
        const deleteActions = [];
        const nonDeleteActions = [];
        // 삭제 작업과 비삭제 작업 분리
        actions.forEach(action => {
            if (action.action.toLowerCase() === 'delete') {
                deleteActions.push(action);
            } else {
                nonDeleteActions.push(action);
            }
        });

        // 비삭제 작업 중복 제거, 테이블 기존 내용 고려
        const uniqueNonDeleteActions = nonDeleteActions.filter((action, index, self) => {
            if (action.action.toLowerCase() === 'insert') {
                const table = DERIVED.any.waitingTable[action.tableIndex];

                // 오류 처리
                if (!table) {
                    console.warn(`테이블 인덱스 ${action.tableIndex}가 유효하지 않아 작업을 건너뜁니다:`, action);
                    return;
                }
                if (!table.content || !Array.isArray(table.content)) {
                    const tableNameForLog = table.tableName ? `(이름: ${table.tableName})` : '';
                    console.warn(`테이블 인덱스 ${action.tableIndex} ${tableNameForLog}의 'content' 속성이 유효하지 않거나 배열이 아닙니다. 빈 배열로 초기화합니다. 원본 'content':`, table.content);
                    table.content = [];
                }


                const dataStr = JSON.stringify(action.data);
                // 检查是否已存在完全相同的行
                const existsInTable = table.content.some(row => JSON.stringify(row) === dataStr);
                const existsInPreviousActions = self.slice(0, index).some(a =>
                    a.action.toLowerCase() === 'insert' &&
                    a.tableIndex === action.tableIndex &&
                    JSON.stringify(a.data) === dataStr
                );
                return !existsInTable && !existsInPreviousActions;
            }
            return index === self.findIndex(a =>
                a.action === action.action &&
                a.tableIndex === action.tableIndex &&
                a.rowIndex === action.rowIndex &&
                JSON.stringify(a.data) === JSON.stringify(action.data)
            );
        });

        // 去重删除 작업并按 rowIndex 降序排序
        const uniqueDeleteActions = deleteActions
            .filter((action, index, self) =>
                index === self.findIndex(a => (
                    a.tableIndex === action.tableIndex &&
                    a.rowIndex === action.rowIndex
                ))
            )
            .sort((a, b) => b.rowIndex - a.rowIndex); // 降序排序，确保大 rowIndex 先执行

        // 合并 작업：先非删除，后删除
        uniqueActions = [...uniqueNonDeleteActions, ...uniqueDeleteActions];

        // 如果不是静默更新，显示 작업确认
        if (!silentUpdate) {
            // 将uniqueActions内容推送给用户确认是否继续
            const confirmContent = confirmTheOperationPerformed(uniqueActions);
            const tableRefreshPopup = new EDITOR.Popup(confirmContent, EDITOR.POPUP_TYPE.TEXT, '', { okButton: "계속하기", cancelButton: "취소" });
            EDITOR.clear();
            await tableRefreshPopup.show();
            if (!tableRefreshPopup.result) {
                EDITOR.info('작업이 취소되었습니다');
                return;
            }
        }

        // 处理用户确认的 작업
        // 执行 작업
        uniqueActions.forEach(action => {
            switch (action.action.toLowerCase()) {
                case 'update':
                    try {
                        const targetRow = DERIVED.any.waitingTable[action.tableIndex].content[action.rowIndex];
                        if (!targetRow || !targetRow[0]?.trim()) {
                            console.log(`Skipped update: table ${action.tableIndex} row ${action.rowIndex} 첫 번째 열이 비어 있습니다`);
                            break;
                        }
                        updateRow(action.tableIndex, action.rowIndex, action.data);
                        console.log(`Updated: table ${action.tableIndex}, row ${action.rowIndex}`, DERIVED.any.waitingTable[action.tableIndex].content[action.rowIndex]);
                    } catch (error) {
                        console.error(`Update 작업 실패: ${error.message}`);
                    }
                    break;
                case 'insert':
                    const requiredColumns = findTableStructureByIndex(action.tableIndex)?.columns || [];
                    const isDataComplete = requiredColumns.every((_, index) => action.data.hasOwnProperty(index.toString()));
                    if (!isDataComplete) {
                        console.error(`삽입 실패：테이블 ${action.tableIndex} 필수 열 데이터가 누락되었습니다`);
                        break;
                    }
                    insertRow(action.tableIndex, action.data);
                    break;
                case 'delete':
                    if (action.tableIndex === 0 || !USER.tableBaseSetting.bool_ignore_del) {
                        const deletedRow = DERIVED.any.waitingTable[action.tableIndex].content[action.rowIndex];
                        deleteRow(action.tableIndex, action.rowIndex);
                        console.log(`Deleted: table ${action.tableIndex}, row ${action.rowIndex}`, deletedRow);
                    } else {
                        console.log(`Ignore: table ${action.tableIndex}, row ${action.rowIndex}`);
                    }
                    break;
            }
        });

        if (USER.tableBaseSetting.bool_ignore_del) {
            EDITOR.success('삭제 보호가 활성화되어 삭제 작업이 무시되었습니다 (플러그인 설정에서 변경 가능)');
        }

        // 更新聊天数据
        chat = USER.getContext().chat[USER.getContext().chat.length - 1];
        chat.dataTable = DERIVED.any.waitingTable;
        USER.getContext().saveChat();
        // 새로고침 UI
        const tableContainer = document.querySelector('#tableContainer');
        refreshContextView();
        updateSystemMessageTableStatus()
        EDITOR.success('테이블 요약 완료');
    } catch (error) {
        console.error('요약 과정에서 오류 발생:', error);
        EDITOR.error(`요약 실패：${error.message}`);
    } finally {

    }
}

export async function rebuildSheets() {
    const container = document.createElement('div');
    console.log('테스트 시작');


    const style = document.createElement('style');
    style.innerHTML = `
        .rebuild-preview-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .rebuild-preview-text {
            display: flex;
            justify-content: left
        }
    `;
    container.appendChild(style);

    // Replace jQuery append with standard DOM methods
    const h3Element = document.createElement('h3');
    h3Element.textContent = '테이블 데이터 재구축';
    container.appendChild(h3Element);

    const previewDiv1 = document.createElement('div');
    previewDiv1.className = 'rebuild-preview-item';
    previewDiv1.innerHTML = `<span>실행 완료 후 확인?: </span>${USER.tableBaseSetting.bool_silent_refresh ? '아니오' : '예'}`;
    container.appendChild(previewDiv1);

    const previewDiv2 = document.createElement('div');
    previewDiv2.className = 'rebuild-preview-item';
    previewDiv2.innerHTML = `<span>API：</span>${USER.tableBaseSetting.use_main_api ? '주 API 사용' : '대체 API 사용'}`;
    container.appendChild(previewDiv2);

    const hr = document.createElement('hr');
    container.appendChild(hr);

    // 선택자 컨테이너 생성
    const selectorContainer = document.createElement('div');
    container.appendChild(selectorContainer);

    // 프롬프트 템플릿 선택자 추가
    const selectorContent = document.createElement('div');
    selectorContent.innerHTML = `
        <span class="rebuild-preview-text" style="margin-top: 10px">프롬프트 템플릿：</span>
        <select id="rebuild_template_selector" class="rebuild-preview-text text_pole" style="width: 100%">
            <option value="">로딩 중...</option>
        </select>
        <span class="rebuild-preview-text" style="margin-top: 10px">템플릿 정보：</span>
        <div id="rebuild_template_info" class="rebuild-preview-text" style="margin-top: 10px"></div>
        <span class="rebuild-preview-text" style="margin-top: 10px">기타 요구사항：</span>
        <textarea id="rebuild_additional_prompt" class="rebuild-preview-text text_pole" style="width: 100%; height: 80px;"></textarea>
    `;
    selectorContainer.appendChild(selectorContent);

    // 선택기 옵션 초기화
    const $selector = $(selectorContent.querySelector('#rebuild_template_selector'))
    const $templateInfo = $(selectorContent.querySelector('#rebuild_template_info'))
    const $additionalPrompt = $(selectorContent.querySelector('#rebuild_additional_prompt'))
    $selector.empty(); // 로딩 중 상태 초기화

    const temps = USER.tableBaseSetting.rebuild_message_template_list
    // 옵션 추가
    Object.entries(temps).forEach(([key, prompt]) => {

        $selector.append(
            $('<option></option>')
                .val(key)
                .text(prompt.name || key)
        );
    });

    // 기본 선택 항목 설정
    // USER에서 마지막으로 선택한 옵션을 읽어오고, 없으면 기본값 사용
    const defaultTemplate = USER.tableBaseSetting?.lastSelectedTemplate || 'rebuild_base';
    $selector.val(defaultTemplate);
    // 템플릿 정보 표시 업데이트
    if (defaultTemplate === 'rebuild_base') {
        $templateInfo.text("기본 템플릿으로 Gemini, Grok, DeepSeek에 적합하며, 채팅 기록과 테이블 정보를 사용하여 테이블을 재구성합니다. 초기 양식 작성, 테이블 최적화 등의 시나리오에 적용됩니다. 제한은 TT 선생님으로부터. ");
    } else {
        const templateInfo = temps[defaultTemplate]?.info || '템플릿 정보 없음';
        $templateInfo.text(templateInfo);
    }

    // 선택기 변화 감지
    $selector.on('change', function () {
        const selectedTemplate = $(this).val();
        const template = temps[selectedTemplate];
        $templateInfo.text(template.info || '템플릿 정보 없음');
    })



    const confirmation = new EDITOR.Popup(container, EDITOR.POPUP_TYPE.CONFIRM, '', {
        okButton: "계속하기",
        cancelButton: "취소"
    });

    await confirmation.show();
    if (confirmation.result) {
        const selectedTemplate = $selector.val();
        const additionalPrompt = $additionalPrompt.val();
        USER.tableBaseSetting.lastSelectedTemplate = selectedTemplate; // 사용자 선택 템플릿 저장
        DERIVED.any.additionalPrompt = additionalPrompt; // 추가 프롬프트 내용 저장
        getPromptAndRebuildTable();
    }
}





/**________________________________________다음은 도우미 함수입니다_________________________________________*/
/**________________________________________다음은 도우미 함수입니다_________________________________________*/
/**________________________________________다음은 도우미 함수입니다_________________________________________*/



// 将Table数组序列化为字符串
function tablesToString(sheets) {
    return JSON.stringify(sheetsToTables(sheets));
}

// 将sheets转化为tables
export function sheetsToTables(sheets) { // Ensure this is exported
    return sheets.map((sheet, index) => ({
        tableName: sheet.name,
        tableIndex: index,
        columns: sheet.getHeader(),
        content: sheet.getContent()
    }))
}

// 将tablesData파싱回Table数组
function tableDataToTables(tablesData) {
    return tablesData.map(item => {
        // 强制确保 columns 是数组，且元素为字符串
        const columns = Array.isArray(item.columns)
            ? item.columns.map(col => String(col)) // 强制转换为字符串
            : inferColumnsFromContent(item.content); // 从 content 推断
        return {
            tableName: item.tableName || '이름 없는 테이블',
            columns,
            content: item.content || [],
            insertedRows: item.insertedRows || [],
            updatedRows: item.updatedRows || []
        }
    });
}

/**
 * 标记테이블变动的内容，用于render时标记颜色
 * @param {*} oldTables
 * @param {*} newTables  *
 */
function compareAndMarkChanges(oldTables, newTables) {
    console.log("标记变动：", oldTables, newTables);
    newTables.forEach((newTable, tableIndex) => {
        const oldTable = oldTables[tableIndex];
        newTable.insertedRows = [];
        newTable.updatedRows = [];

        // 标记新增行（过滤空行）
        newTable.content.filter(Boolean).forEach((_, rowIndex) => {
            if (rowIndex >= oldTable.content.filter(Boolean).length) {
                newTable.insertedRows.push(rowIndex);
            }
        });

        // 标记更新单元格（只比较有效行）
        oldTable.content.filter(Boolean).forEach((oldRow, rowIndex) => {
            const newRow = newTable.content[rowIndex];
            if (newRow) {
                oldRow.forEach((oldCell, colIndex) => {
                    if (newRow[colIndex] !== oldCell) {
                        newTable.updatedRows.push(`${rowIndex}-${colIndex}`);
                    }
                });
            }
        });
    });
}

function inferColumnsFromContent(content) {
    if (!content || content.length === 0) return [];
    const firstRow = content[0];
    return firstRow.map((_, index) => `열${index + 1}`);
}

/**
* 提取聊天记录获取功能
* 提取最近的chatStairs条聊天记录
* @param {Array} chat - 聊天记录数组
* @param {number} chatStairs - 要提取的聊天记录数量
* @param {boolean} ignoreUserSent - 是否忽略用户发送的消息
* @param {number|null} tokenLimit - 最大token限制，null表示无限制，优先级高于chatStairs
* @returns {string} 提取的聊天记录字符串
*/
async function getRecentChatHistory(chat, chatStairs, ignoreUserSent = false, tokenLimit = 0) {
    let filteredChat = chat;

    // 处理忽略用户发送消息的情况
    if (ignoreUserSent && chat.length > 0) {
        filteredChat = chat.filter(c => c.is_user === false);
    }

    // 有效记录提示
    if (filteredChat.length < chatStairs && tokenLimit === 0) {
        EDITOR.success(`현재 유효 기록 ${filteredChat.length}개, 설정한 ${chatStairs}개보다 적습니다`);
    }

    const collected = [];
    let totalTokens = 0;

    // 从最新记录开始逆序遍历
    for (let i = filteredChat.length - 1; i >= 0; i--) {
        // 格式化消息并清理标签
        const currentStr = `${filteredChat[i].name}: ${filteredChat[i].mes}`
            .replace(/<tableEdit>[\s\S]*?<\/tableEdit>/g, '');

        // 计算Token
        const tokens = await estimateTokenCount(currentStr);

        // 如果是第一条消息且token数超过限制，直接添加该消息
        if (i === filteredChat.length - 1 && tokenLimit !== 0 && tokens > tokenLimit) {
            totalTokens = tokens;
            EDITOR.success(`최근의 채팅 기록 Token 수는 ${tokens}이며, 설정한 ${tokenLimit} 제한을 초과하므로 해당 채팅 기록을 직접 사용합니다.`);
            console.log(`최근의 채팅 기록 Token 수는 ${tokens}이며, 설정한 ${tokenLimit} 제한을 초과하므로 해당 채팅 기록을 직접 사용합니다.`);
            collected.push(currentStr);
            break;
        }

        // Token限制检查
        if (tokenLimit !== 0 && (totalTokens + tokens) > tokenLimit) {
            EDITOR.success(`이번에 전송된 채팅 기록 토큰 수는 약 ${totalTokens}개이며, 총 ${collected.length}개입니다.`);
            console.log(`이번에 전송된 채팅 기록 토큰 수는 약 ${totalTokens}개이며, 총 ${collected.length}개입니다.`);
            break;
        }

        // 更新计数
        totalTokens += tokens;
        collected.push(currentStr);

        // 当 tokenLimit 为 0 时，进行聊天记录数量限制检查
        if (tokenLimit === 0 && collected.length >= chatStairs) {
            break;
        }
    }

    // 按时间顺序排列并拼接
    const chatHistory = collected.reverse().join('\n');
    return chatHistory;
}

// 测试清理效果
window.testFuncClean = function (strTest) {
    strTest = ``
    cleanApiResponse(strTest)
};

/**
 * API 응답의 원본 내용 정제
 * @param {string} rawContent - 원본 API 응답 내용
 * @param {Object} [options={}] - 정제 설정 옵션
 * @param {boolean} [options.removeCodeBlock=true] - JSON 코드 블록 마커 제거 여부
 * @param {boolean} [options.extractJson=true] - 첫 번째 JSON 배열/객체 추출 여부
 * @param {boolean} [options.normalizeKeys=true] - 키 이름 형식 통일 여부
 * @param {boolean} [options.convertSingleQuotes=true] - 작은따옴표를 큰따옴표로 변환 여부
 * @param {boolean} [options.removeBlockComments=true] - 블록 주석 제거 여부
 * @returns {string} 정제된 표준화 내용
 */
function cleanApiResponse(rawContent, options = {}) {
    const {
        removeCodeBlock = true,       // 코드 블록 마커 제거
        extractJson = true,           // JSON 부분 추출
        normalizeKeys = true,         // 키 이름 형식 통일
        convertSingleQuotes = true,   // 작은따옴표를 큰따옴표로 변환
        normalizeTableStructure = true, // 테이블 구조 표준화, tablename에서 columns 부분 처리, 중국어 따옴표를 영어 따옴표로 변환
        normalizeAndValidateColumnsContentPairs = true, // 테이블 구조 표준화, content 부분 처리, 중국어 따옴표를 영어 따옴표로 변환, 열 수와 행 수 일치 여부 및 형식 문제 확인, 문제 시 원본으로 복구
        removeBlockComments = true    // 블록 주석 제거
    } = options;

    let content = rawContent;

    // 按顺序执行清洗步骤
    if (removeCodeBlock) {
        // ```json과 ``` 코드 블록 마커 제거
        content = content.replace(/```json|```/g, '');
        console.log("removeCodeBlock", content)
    }
    if (extractJson) {
        // 첫 번째 완전한 JSON 배열/객체 추출(여러 줄 매칭 지원)
        const start = content.indexOf('[');
        const end = content.lastIndexOf(']');
        if (start === -1 || end === -1 || end <= start) {
            console.error('유효한 JSON 배열 구조를 찾을 수 없습니다');
            return null;
        }
        content = content.slice(start, end + 1);
    }
    if (normalizeKeys) {
        // 키 이름 형식 통일: 따옴표가 있거나 없는 키 이름을 큰따옴표로 표준화
        content = content.replace(/([{,]\s*)(?:"?([a-zA-Z_]\w*)"?\s*:)/g, '$1"$2":');
        console.log("normalizeKeys", content)
    }
    if (convertSingleQuotes) {
        // 将单引号转换为双引号（JSON标准要求双引号）
        content = content.replace(/'/g, '"');
        console.log("convertSingleQuotes", content)
    }
    if (normalizeTableStructure) {
        // 标准化테이블结构，处理tablename到columns部分，中文引号改为英文引号
        const regex = /([\"“”])tableName\1\s*:\s*([\"“”])(.+?)\2\s*,\s*([\"“”])tableIndex\4\s*:\s*(\d+)\s*,\s*([\"“”])columns(?:[\"“”]?)/g;
        content = content.replace(regex, (match, g1QuoteKeyTable, g2QuoteValueTable, g3TableName, g4QuoteKeyIndex, g5TableIndex, g6QuoteKeyColumns) => {
            return `"tableName":"${g3TableName}","tableIndex":${g5TableIndex},"columns"`;
        });
        console.log("normalizeTableStructure", content)
    }
    function replaceQuotesInContext(text) {
        if (typeof text !== 'string') return text;
        return text.replace(/[“”]/g, (match, offset, fullString) => {
            const charBefore = offset > 0 ? fullString[offset - 1] : null;
            const charAfter = offset + match.length < fullString.length ? fullString[offset + match.length] : null;
            const contextChars = ['[', ']', ','];

            if ((charBefore && contextChars.includes(charBefore)) || (charAfter && contextChars.includes(charAfter))) {
                return '"';
            }
            return match;
        });
    }

    if (normalizeAndValidateColumnsContentPairs) {
        // 标准化테이블结构，处理content部分，中文引号改为英文引号，然后检查列数和行数是否匹配以及格式问题，否则回退到原始内容
        const regex = /([\"“”])columns\1\s*:\s*(\[.*?\])\s*,\s*([\"“”])content\3\s*:\s*(\[(?:\[.*?\](?:,\s*\[.*?\])*)?\])/g;
        content = content.replace(regex, (match, _quoteKeyColumns, columnsArrayStr, _quoteKeyContent, contentArrayStr) => {
            let normalizedColumnsArrayStr = replaceQuotesInContext(columnsArrayStr);
            let normalizedContentArrayStr = replaceQuotesInContext(contentArrayStr);

            let columns;
            try {
                columns = JSON.parse(normalizedColumnsArrayStr);
                if (!Array.isArray(columns) || !columns.every(col => typeof col === 'string')) {
                    console.warn("警告: 'columns' 部分파싱后不是一个有效的字符串数组。原始片段:", columnsArrayStr, "处理后尝试파싱:", normalizedColumnsArrayStr, "파싱结果:", columns);
                    return match;
                }
            } catch (e) {
                console.warn("警告: 파싱 'columns' 数组실패。错误:", e, "原始片段:", columnsArrayStr, "处理后尝试파싱:", normalizedColumnsArrayStr);
                return match;
            }

            let contentRows;
            try {
                contentRows = JSON.parse(normalizedContentArrayStr);
                if (!Array.isArray(contentRows)) {
                    console.warn("警告: 'content' 部分파싱后不是一个有效的数组。原始片段:", contentArrayStr, "处理后尝试파싱:", normalizedContentArrayStr, "파싱结果:", contentRows);
                    return match;
                }
            } catch (e) {
                console.warn("警告: 파싱 'content' 数组실패。错误:", e, "原始片段:", contentArrayStr, "处理后尝试파싱:", normalizedContentArrayStr);
                return match;
            }

            const numColumns = columns.length;
            const validatedContentRows = [];
            let allRowsValid = true;

            for (const row of contentRows) {
                if (!Array.isArray(row) || row.length !== numColumns) {
                    console.warn(`警告: 内容行与列数 (${numColumns}) 不匹配或行本身不是数组。行数据:`, row);
                    allRowsValid = false;
                    break;
                }
                if (!row.every(cell => typeof cell === 'string')) {
                    console.warn("警告: 内容行中并非所有单元格都是字符串。行数据:", row);
                    allRowsValid = false;
                    break;
                }
                validatedContentRows.push(row);
            }

            if (!allRowsValid) {
                console.warn("警告: 'content' 数组的某些行未通过验证，该 'columns'-'content' 片段将不会被修改。");
                return match;
            }

            const finalColumnsStr = JSON.stringify(columns);
            const finalContentStr = JSON.stringify(validatedContentRows);

            return `"columns":${finalColumnsStr},"content":${finalContentStr}`;
        });
        console.log("normalizeAndValidateColumnsContentPairs", content)
    }
    if (removeBlockComments) {
        // 移除 /* ... */ 形式的块注释
        content = content.replace(/\/\*.*?\*\//g, '');
        console.log("removeBlockComments", content)
    }
    // 通过括号配平来确定JSON的结束位置
    const openChar = content[0];
    const closeChar = (openChar === '[') ? ']' : '}';
    let balance = 0;
    let lastCharIndex = -1;

    for (let i = 0; i < content.length; i++) {
        if (content[i] === openChar) {
            balance++;
        } else if (content[i] === closeChar) {
            balance--;
        }
        if (balance === 0) {
            lastCharIndex = i;
            content = content.substring(0, lastCharIndex + 1);
            break;
        }
    }

    // 去除首尾空白
    content = content.trim();
    console.log('清洗前的内容:', rawContent);
    console.log('清洗后的内容:', content);

    return content;
}

/**
 * 修复테이블格式
 * @param {string} inputText - 输入的文本
 * @returns {string} 修复后的文本
 * */
function fixTableFormat(inputText) {
    const safeParse = (str) => {
        try {
            return JSON.parse(str);
        } catch (primaryError) {
            // 深度清洗：处理未闭合引号和注释
            const deepClean = str
                .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":')  // 修复键名引号
                .replace(/\/\/.*?\n/g, '')    // 移除行注释
                .replace(/([:,])\s*([^"{[\s-]+)(\s*[}\]])/g, '$1 "$2"$3') // 补全缺失引号
                .replace(/'/g, '"')           // 单引号转双引号
                .replace(/(\w)\s*"/g, '$1"')  // 清理键名后多余空格
                .replace(/,\s*]/g, ']')       // 移除尾逗号
                .replace(/}\s*{/g, '},{');    // 修复缺失的数组分隔符

            try {
                return JSON.parse(deepClean);
            } catch (fallbackError) {
                throw new Error(`파싱실패: ${fallbackError.message}`);
            }
        }
    };

    const extractTable = (text) => {
        let balance = 0;
        let startIndex = -1;
        let inString = false;
        let escapeNext = false;

        // 查找潜在数组的第一个左方括号
        let initialArrayIndex = -1;
        for (let i = 0; i < text.length; i++) {
            if (text[i] === '[') {
                initialArrayIndex = i;
                break;
            }
        }

        if (initialArrayIndex === -1) {
            console.warn("extractTable: 未找到左方括号 '['。将回退到正则表达式。");
            const regex = /\[(?:[^\[\]"]|"(?:\\.|[^"\\])*"|\{[^{}]*?\})*?\]/g;
            let match;
            const candidates = [];
            while ((match = regex.exec(text)) !== null) {
                try {
                    JSON5.parse(match[0]);
                    candidates.push(match[0]);
                } catch (e) { /* 忽略无效的JSON */ }
            }
            if (candidates.length > 0) return candidates.sort((a, b) => b.length - a.length)[0];
            const simpleCandidates = text.match(/\[[^\[\]]*\]/g) || [];
            return simpleCandidates.sort((a, b) => b.length - a.length)[0] || null;
        }

        startIndex = initialArrayIndex;

        for (let i = startIndex; i < text.length; i++) {
            const char = text[i];

            if (escapeNext) {
                escapeNext = false;
                continue;
            }

            if (char === '\\') {
                escapeNext = true;
                continue;
            }

            if (char === '"') {
                inString = !inString;
            }

            if (inString) {
                continue;
            }

            if (char === '[') {
                balance++;
            } else if (char === ']') {
                balance--;
                if (balance === 0 && startIndex !== -1) {
                    const extracted = text.substring(startIndex, i + 1);
                    try {
                        JSON5.parse(extracted);
                        return extracted;
                    } catch (e) {
                        console.error("extractTable: 通过括号计数提取的片段不是有效的JSON。片段:", extracted, "错误:", e, "正在回退。");
                        startIndex = -1; // 使当前尝试无效
                        balance = 0; // 重置计数
                        break; // 退出循环以进行回退
                    }
                }
            }
        }
        EDITOR.clear();
        EDITOR.error("API에서 오류 메시지가 반환되었습니다!");
        EDITOR.error(inputText.length > 300 ? inputText.slice(0, 300) + '...' : inputText);
        throw new Error("완전하고 유효한 JSON 배열을 찾을 수 없어 프로세스가 중단되었습니다!");

        // console.warn("extractTable: 括号计数未能找到完整的有效JSON数组。将回退到正则表达式。");
        // const regex = /\[(?:[^\[\]"]|"(?:\\.|[^"\\])*"|\{[^{}]*?\})*?\]/g;
        // let match;
        // const candidates = [];
        // while((match = regex.exec(text)) !== null) {
        //     try {
        //         JSON5.parse(match[0]);
        //         candidates.push(match[0]);
        //     } catch(e) { /* 忽略无效的JSON */ }
        // }
        //
        // if (candidates.length > 0) {
        //     return candidates.sort((a, b) => b.length - a.length)[0];
        // }

        // console.warn("extractTable: 改进的正则表达式也실패了。将回退到原始的简单正则表达式。");
        // const simpleCandidates = text.match(/\[[^\[\]]*\]/g) || [];
        // return simpleCandidates.sort((a, b) => b.length - a.length)[0] || null;
    };

    // 主流程
    try {
        let jsonStr = cleanApiResponse(inputText)
        console.log('cleanApiResponse预处理后:', jsonStr);
        jsonStr = extractTable(jsonStr);
        console.log('extractTable提取后:', jsonStr);
        if (!jsonStr) throw new Error("유효한 테이블 데이터를 찾을 수 없습니다");

        // 关键预处理：修复常见格式错误
        jsonStr = jsonStr
            .replace(/(\w)\s*"/g, '$1"')        // 键名后空格
            .replace(/:\s*([^"{\[]+)(\s*[,}])/g, ': "$1"$2')    // 值缺失引号
            .replace(/"tableIndex":\s*"(\d+)"/g, '"tableIndex": $1')    // 移除tableIndex的引号
            .replace(/"\s*\+\s*"/g, '')         // 拼接字符串残留
            .replace(/\\n/g, '')                // 秼除换行转义
            .replace(/({|,)\s*([a-zA-Z_]+)\s*:/g, '$1"$2":')    // 键名标准化
            .replace(/"(\d+)":/g, '$1:')  // 修复数字键格式

        console.log('关键预处理修复常见格式错误后:', jsonStr);

        // 强约束파싱
        let tables = safeParse(jsonStr);
        console.log('safeParse强约束파싱后:', tables);

        tables = tables.map(table => ({  // 新增：类型转换
            ...table,
            tableIndex: parseInt(table.tableIndex) || 0
        }));


        // 列对齐修正
        return tables.map((table, index) => {
            if (!table || typeof table !== 'object') {
                console.error(`处理索引 ${index} 处的테이블时出错：테이블数据无效（null、undefined 或不是对象）。接收到：`, table);
                return { tableName: `무효 테이블 (색인 ${index})`, columns: [], content: [] }; // 返回默认的空테이블结构
            }

            let columnCount = 0;
            if (table.columns) {
                if (Array.isArray(table.columns)) {
                    columnCount = table.columns.length;
                } else {
                    console.error(`테이블 "${table.tableName || `(원본 인덱스 ${index})`}"가 매핑 인덱스 ${index}에 있는 테이블 구조 오류: 'columns' 속성이 배열이 아닙니다. 찾은 내용:`, table.columns);
                }
            } else {
                console.error(`테이블 "${table.tableName || `(원본 인덱스 ${index})`}"가 매핑 인덱스 ${index}에 있는 테이블 구조 오류: 'columns' 속성이 누락되었습니다. 찾은 내용:`, table);
            }

            if (Array.isArray(table.content)) {
                table.content = table.content.map(row => {
                    if (row === null || row === undefined) {
                        return Array(columnCount).fill("");
                    }
                    return Array.from({ length: columnCount }, (_, i) => row[i]?.toString().trim() || "");
                });
            } else {
                console.error(`테이블 "${table.tableName || `(원본 인덱스 ${index})`}"가 매핑 인덱스 ${index}에 있는 테이블 구조 오류: 'content' 속성이 배열이 아닙니다. 찾은 내용:`, table.content);
                table.content = []; // 如果 'content' 不是数组或缺失，则默认为空
            }
            return table;
        });
    } catch (error) {
        console.error("修复실패:", error);
        throw new Error('테이블 데이터를 파싱할 수 없습니다');
        // 原暴力提取逻辑已禁用
        // const rawTables = inputText.match(/{[^}]*?"tableIndex":\s*\d+[^}]*}/g) || [];
        // const sixTables = rawTables.slice(0, 6).map(t => JSON.parse(t.replace(/'/g, '"')));
        // return sixTables
    }
}

/**
 * 修改重整理模板
 */
export async function modifyRebuildTemplate() {
    const selectedTemplate = USER.tableBaseSetting.lastSelectedTemplate;
    const sheetConfig = {
        formTitle: "테이블 요약 템플릿 편집",
        formDescription: "요약 시 프롬프트 구조를 설정합니다. $0은 현재 테이블 데이터, $1은 컨텍스트 채팅 기록, $2는 테이블 템플릿[헤더] 데이터, $3은 사용자가 입력한 추가 프롬프트입니다.",
        fields: [
            { label: '템플릿 이름:', type: 'label', text: selectedTemplate },
            { label: '시스템 프롬프트', type: 'textarea', rows: 6, dataKey: 'system_prompt', description: '(제한 해제 내용을 입력하거나 프롬프트 전체 JSON 구조를 직접 입력하세요. 구조를 입력하면 정리 규칙이 무시됩니다)' },
            { label: '요약 규칙', type: 'textarea', rows: 6, dataKey: 'user_prompt_begin', description: '(AI에게 재정리 방법을 설명하는 데 사용됩니다)' },
        ],
    }
    let initialData = null
    if (selectedTemplate === 'rebuild_base')
        return EDITOR.warning('기본 템플릿은 수정할 수 없습니다. 새 템플릿을 만드세요.');
    else
        initialData = USER.tableBaseSetting.rebuild_message_template_list[selectedTemplate]
    const formInstance = new Form(sheetConfig, initialData);
    const popup = new EDITOR.Popup(formInstance.renderForm(), EDITOR.POPUP_TYPE.CONFIRM, '', { okButton: "저장", allowVerticalScrolling: true, cancelButton: "취소" });
    await popup.show();
    if (popup.result) {
        const result = formInstance.result();
        USER.tableBaseSetting.rebuild_message_template_list = {
            ...USER.tableBaseSetting.rebuild_message_template_list,
            [selectedTemplate]: {
                ...result,
                name: selectedTemplate,
            }
        }
        EDITOR.success(`템플릿 수정 "${selectedTemplate}" 성공`);
    }
}
/*         

/**
 * 新建重整理模板
 */
export async function newRebuildTemplate() {
    const sheetConfig = {
        formTitle: "새 테이블 요약 템플릿",
        formDescription: "테이블 요약 시 프롬프트 구조를 설정합니다. $0은 현재 테이블 데이터, $1은 컨텍스트 채팅 기록, $2는 테이블 템플릿[헤더] 데이터, $3은 사용자가 입력한 추가 프롬프트입니다.",
        fields: [
            { label: '템플릿 이름', type: 'text', dataKey: 'name' },
            { label: '시스템 프롬프트', type: 'textarea', rows: 6, dataKey: 'system_prompt', description: '(제한 해제 내용을 입력하거나 프롬프트 전체 JSON 구조를 직접 입력하세요. 구조를 입력하면 정리 규칙이 무시됩니다)' },
            { label: '정리 규칙', type: 'textarea', rows: 6, dataKey: 'user_prompt_begin', description: '(AI에게 재정리 방법을 설명하는 데 사용됩니다)' },
        ],
    }
    const initialData = {
        name: "새 테이블 요약 템플릿",
        system_prompt: USER.tableBaseSetting.rebuild_default_system_message_template,
        user_prompt_begin: USER.tableBaseSetting.rebuild_default_message_template,
    };
    const formInstance = new Form(sheetConfig, initialData);
    const popup = new EDITOR.Popup(formInstance.renderForm(), EDITOR.POPUP_TYPE.CONFIRM, '', { okButton: "저장", allowVerticalScrolling: true, cancelButton: "취소" });
    await popup.show();
    if (popup.result) {
        const result = formInstance.result();
        const name = createUniqueName(result.name)
        result.name = name;
        USER.tableBaseSetting.rebuild_message_template_list = {
            ...USER.tableBaseSetting.rebuild_message_template_list,
            [name]: result
        }
        USER.tableBaseSetting.lastSelectedTemplate = name;
        refreshRebuildTemplate()
        EDITOR.success(`새 템플릿 "${name}" 생성 성공`);
    }
}

/**
 * 创建不重复的名称
 * @param {string} baseName - 基础名称
 */
function createUniqueName(baseName) {
    let name = baseName;
    let counter = 1;
    while (USER.tableBaseSetting.rebuild_message_template_list[name]) {
        name = `${baseName} (${counter})`;
        counter++;
    }
    return name;
}

/**
 * 删除重整理模板
 */
export async function deleteRebuildTemplate() {
    const selectedTemplate = USER.tableBaseSetting.lastSelectedTemplate;
    if (selectedTemplate === 'rebuild_base') {
        return EDITOR.warning('기본 템플릿은 삭제할 수 없습니다.');
    }
    const confirmation = await EDITOR.callGenericPopup('이 템플릿을 삭제하시겠습니까？', EDITOR.POPUP_TYPE.CONFIRM, '', { okButton: "계속하기", cancelButton: "취소" });
    if (confirmation) {
        const newTemplates = {};
        Object.values(USER.tableBaseSetting.rebuild_message_template_list).forEach((template) => {
            if (template.name !== selectedTemplate) {
                newTemplates[template.name] = template;
            }
        });
        USER.tableBaseSetting.rebuild_message_template_list = newTemplates;
        USER.tableBaseSetting.lastSelectedTemplate = 'rebuild_base';
        refreshRebuildTemplate();
        EDITOR.success(`템플릿 "${selectedTemplate}" 삭제 성공`);
    }
}

/**
 * 导出重整理模板
 */
export async function exportRebuildTemplate() {
    const selectedTemplate = USER.tableBaseSetting.lastSelectedTemplate;
    if (selectedTemplate === 'rebuild_base') {
        return EDITOR.warning('기본 템플릿은 내보낼 수 없습니다.');
    }
    const template = USER.tableBaseSetting.rebuild_message_template_list[selectedTemplate];
    if (!template) {
        return EDITOR.error(`템플릿 "${selectedTemplate}"을(를) 찾을 수 없습니다.`);
    }
    const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedTemplate}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    EDITOR.success(`템플릿 "${selectedTemplate}" 내보내기 성공`);
}

/**
 * 导入重整理模板
 */
export async function importRebuildTemplate() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.style.display = 'none';
    document.body.appendChild(input);

    input.addEventListener('change', async (event) => {
        const file = event.target.files[0];
        if (!file) {
            EDITOR.error('파일을 선택하지 않았습니다');
            return;
        }
        try {
            const text = await file.text();
            const template = JSON.parse(text);
            if (!template.name || !template.system_prompt || !template.user_prompt_begin) {
                throw new Error('유효하지 않은 템플릿 형식입니다');
            }
            const name = createUniqueName(template.name);
            template.name = name;
            USER.tableBaseSetting.rebuild_message_template_list = {
                ...USER.tableBaseSetting.rebuild_message_template_list,
                [name]: template
            };
            USER.tableBaseSetting.lastSelectedTemplate = name;
            refreshRebuildTemplate();
            EDITOR.success(`템플릿 "${name}" 가져오기 성공`);
        } catch (error) {
            EDITOR.error(`가져오기 실패：${error.message}`);
        } finally {
            document.body.removeChild(input);
        }
    });

    input.click();
}

/**
 * 手动触发一次分步填表
 */
export async function triggerStepByStepNow() {
    console.log('[Memory Enhancement] Manually triggering step-by-step update...');
    TableTwoStepSummary("manual")
}

/**
 * 执行增量更新（可用于普通새로고침和分步总结）
 * @param {string} chatToBeUsed - 要使用的聊天记录, 为空则使用最近的聊天记录
 * @param {string} originTableText - 当前테이블的文本表示
 * @param {Array} referencePiece - 参考用的piece
 * @param {boolean} useMainAPI - 是否使用주 API
 * @param {boolean} silentUpdate - 是否静默更新,不显示 작업确认
 * @param {boolean} [isSilentMode=false] - 是否以静默模式运行API调用（不显示加载提示）
 * @returns {Promise<string>} 'success', 'suspended', 'error', or empty
 */
export async function executeIncrementalUpdateFromSummary(
    chatToBeUsed = '',
    originTableText,
    finalPrompt,
    referencePiece,
    useMainAPI,
    silentUpdate = USER.tableBaseSetting.bool_silent_refresh,
    isSilentMode = false
) {
    if (!SYSTEM.lazy('executeIncrementalUpdate', 1000)) return '';

    try {
        DERIVED.any.waitingPiece = referencePiece;
        const separateReadContextLayers = Number($('#separateReadContextLayers').val());
        const contextChats = await getRecentChatHistory(USER.getContext().chat, separateReadContextLayers, true);
        const summaryChats = chatToBeUsed;

        // 获取角色世界书内容
        let lorebookContent = '';
        if (USER.tableBaseSetting.separateReadLorebook && window.TavernHelper) {
            try {
                const charLorebooks = await window.TavernHelper.getCharLorebooks({ type: 'all' });
                const bookNames = [];
                if (charLorebooks.primary) {
                    bookNames.push(charLorebooks.primary);
                }
                if (charLorebooks.additional && charLorebooks.additional.length > 0) {
                    bookNames.push(...charLorebooks.additional);
                }

                for (const bookName of bookNames) {
                    if (bookName) {
                        const entries = await window.TavernHelper.getLorebookEntries(bookName);
                        if (entries && entries.length > 0) {
                            lorebookContent += entries.map(entry => entry.content).join('\n');
                        }
                    }
                }
            } catch (e) {
                console.error('[Memory Enhancement] Error fetching lorebook content:', e);
            }
        }

        let systemPromptForApi;
        let userPromptForApi;

        console.log("[Memory Enhancement] Step-by-step summary: Parsing and using multi-message template string.");
        const stepByStepPromptString = USER.tableBaseSetting.step_by_step_user_prompt;
        let promptMessages;

        try {
            promptMessages = JSON5.parse(stepByStepPromptString);
            if (!Array.isArray(promptMessages) || promptMessages.length === 0) {
                throw new Error("Parsed prompt is not a valid non-empty array.");
            }
        } catch (e) {
            console.error("Error parsing step_by_step_user_prompt string:", e, "Raw string:", stepByStepPromptString);
            EDITOR.error("독립 양식 작성 프롬프트 형식이 잘못되어 파싱할 수 없습니다. 플러그인 설정을 확인하십시오.");
            return 'error';
        }

        const replacePlaceholders = (text) => {
            if (typeof text !== 'string') return '';
            text = text.replace(/(?<!\\)\$0/g, () => originTableText);
            text = text.replace(/(?<!\\)\$1/g, () => contextChats);
            text = text.replace(/(?<!\\)\$2/g, () => summaryChats);
            text = text.replace(/(?<!\\)\$3/g, () => finalPrompt);
            text = text.replace(/(?<!\\)\$4/g, () => lorebookContent);
            return text;
        };

        // 完整处理消息数组，替换每个消息中的占位符
        const processedMessages = promptMessages.map(msg => ({
            ...msg,
            content: replacePlaceholders(msg.content)
        }));

        // 将处理后的完整消息数组传递给API请求处理函数
        systemPromptForApi = processedMessages;
        userPromptForApi = null; // 在这种情况下，userPromptForApi 不再需要

        console.log("Step-by-step: Prompts constructed from parsed multi-message template and sent as an array.");

        // 打印将要发送到API的最终数据
        if (Array.isArray(systemPromptForApi)) {
            console.log('API-bound data (as message array):', systemPromptForApi);
            const totalContent = systemPromptForApi.map(m => m.content).join('');
            console.log('Estimated token count:', estimateTokenCount(totalContent));
        } else {
            console.log('System Prompt for API:', systemPromptForApi);
            console.log('User Prompt for API:', userPromptForApi);
            console.log('Estimated token count:', estimateTokenCount(systemPromptForApi + (userPromptForApi || '')));
        }

        let rawContent;
        if (useMainAPI) { // Using Main API
            try {
                // If it's step-by-step summary, systemPromptForApi is already the message array
                // Pass the array as the first arg and null/empty as the second for multi-message format
                // Otherwise, pass the separate system and user prompts for normal refresh
                rawContent = await handleMainAPIRequest(
                    systemPromptForApi,
                    null,
                    isSilentMode
                );
                if (rawContent === 'suspended') {
                    EDITOR.info('작업이 취소되었습니다 (주API)');
                    return 'suspended';
                }
            } catch (error) {
                console.error('주 API 요청 오류:', error);
                EDITOR.error('주 API 요청 오류: ' + error.message, error);
                return 'error';
            }
        } else { // Using Custom API
            try {
                rawContent = await handleCustomAPIRequest(systemPromptForApi, userPromptForApi, true, isSilentMode);
                if (rawContent === 'suspended') {
                    EDITOR.info('작업이 취소되었습니다 (사용자 정의 API)');
                    return 'suspended';
                }
            } catch (error) {
                EDITOR.error('사용자 정의 API 요청 오류: ' + error.message);
                return 'error';
            }
        }

        if (typeof rawContent !== 'string' || !rawContent.trim()) {
            EDITOR.error('API 응답 내용이 유효하지 않거나 비어 있습니다.');
            return 'error';
        }

        // **核心修复**: 使用与常规填表完全一致的 getTableEditTag 函数来提取指令
        const { matches } = getTableEditTag(rawContent);

        if (!matches || matches.length === 0) {
            EDITOR.info("AI가 유효한 <tableEdit> 작업 지시어를 반환하지 않았습니다. 테이블 내용이 변경되지 않았습니다.");
            return 'success';
        }

        try {
            // 将提取到的、未经修改的原始指令数组传递给执行器
            executeTableEditActions(matches, referencePiece)
        } catch (e) {
            EDITOR.error("테이블 작업 지시어를 실행하는 중 오류 발생: ", e.message, e);
            console.error("오류 원문: ", matches.join('\n'));
        }
        USER.saveChat()
        refreshContextView();
        updateSystemMessageTableStatus();
        EDITOR.success('독립 프롬프트 완료!');
        return 'success';

    } catch (error) {
        console.error('증분 업데이트 실행 중 오류 발생:', error);
        EDITOR.error(`증분 업데이트 실행 실패: ${error.message}`);
        console.log('[Memory Enhancement Plugin] Error context:', {
            timestamp: new Date().toISOString(),
            error: error.message,
            stack: error.stack,
        });
        return 'error';
    }
}
