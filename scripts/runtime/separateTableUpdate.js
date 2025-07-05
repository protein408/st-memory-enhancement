import {BASE, DERIVED, EDITOR, SYSTEM, USER} from '../../core/manager.js';
import { executeIncrementalUpdateFromSummary, sheetsToTables } from "./absoluteRefresh.js";
import { newPopupConfirm } from '../../components/popupConfirm.js';
import { reloadCurrentChat } from "/script.js"
import {getTablePrompt,initTableData, undoSheets} from "../../index.js"

let toBeExecuted = [];

/**
 * 初始化两步总结所需的数据
 * @param chat
 * */
function InitChatForTableTwoStepSummary(chat) {
    // 如果currentPiece.uid未定义，则初始化为随机字符串
    if (chat.uid === undefined) {
        chat.uid = SYSTEM.generateRandomString(22);
    }
    // 如果currentPiece.uid_that_references_table_step_update未定义，则初始化为{}
    if (chat.two_step_links === undefined) {
        chat.two_step_links = {};
    }
    // 如果currentPiece.uid_that_references_table_step_update未定义，则初始化为{}
    if (chat.two_step_waiting === undefined) {
        chat.two_step_waiting = {};
    }
}

/**
 * 获取当前滑动对话的唯一标识符
 * @param chat
 * @returns {string}
 */
function getSwipeUid(chat) {
    // 初始化chat
    InitChatForTableTwoStepSummary(chat);
    // 获取当前swipe的唯一标识符
    const swipeUid = `${chat.uid}_${chat.swipe_id}`;
    // 检查当前swipe是否已经存在必要的数据结构
    if (!(swipeUid in chat.two_step_links)) chat.two_step_links[swipeUid] = [];
    if (!(swipeUid in chat.two_step_waiting)) chat.two_step_waiting[swipeUid] = true;
    return swipeUid;
}

/**
 * 检查当前chat是否已经被父级chat执行过
 * @param chat
 * @param targetSwipeUid
 * @returns {*}
 */
function checkIfChatIsExecuted(chat, targetSwipeUid) {
    const chatSwipeUid = getSwipeUid(chat); // 获取当前chat的唯一标识符
    const chatExecutedSwipes = chat.two_step_links[chatSwipeUid]; // 获取当前chat已经执行过的父级chat
    return chatExecutedSwipes.includes(targetSwipeUid);   // 检查当前chat是否已经被目标chat执行过
}

/**
 * 处理对话中的标识符
 * @param string
 * @returns {string}
 */
function handleMessages(string) {
    let r = string.replace(/<(tableEdit|think|thinking)>[\s\S]*?<\/\1>/g, '');

    return r;
}

function MarkChatAsWaiting(chat, swipeUid) {
    console.log(USER.getContext().chat);
    console.log('chat.two_step_links:',chat.two_step_links);
    console.log('chat.two_step_waiting:',chat.two_step_waiting);
    chat.two_step_waiting[swipeUid] = true;
}

/**
 * 执行两步总结
 * */
export async function TableTwoStepSummary(mode) {
    if (mode!=="manual" && (USER.tableBaseSetting.isExtensionAble === false || USER.tableBaseSetting.step_by_step === false)) return

    // 获取需要执行的两步总结
    const {piece: todoPiece} = USER.getChatPiece()

    if (todoPiece === undefined) {
        console.log('未找到待填表的对话片段');
        EDITOR.error('작성할 양식의 채팅 기록을 찾을 수 없습니다. 현재 채팅이 올바른지 확인해주세요.');
        return;
    }
    let todoChats = todoPiece.mes;

    console.log('待填表的对话片段:', todoChats);

    // 检查是否开启执行前确认
    const popupContentHtml = `총 \${todoChats.length} 길이의 텍스트가 누적되었습니다. 독립적으로 표 작성을 시작할까요?`;
    // 移除了模板选择相关的HTML和逻辑

    const popupId = 'stepwiseSummaryConfirm';
    const confirmResult = await newPopupConfirm(
        popupContentHtml,
        "취소",
        "표 작성 실행",
        popupId,
        "더 이상 알림 표시 안 함", // dontRemindText: Permanently disables the popup
        "항상 확인"  // alwaysConfirmText: Confirms for the session
    );

    console.log('newPopupConfirm result for stepwise summary:', confirmResult);

    if (confirmResult === false) {
        console.log('用户取消执行独立填表: ', `(${todoChats.length}) `, toBeExecuted);
        MarkChatAsWaiting(currentPiece, swipeUid);
    } else {
        // This block executes if confirmResult is true OR 'dont_remind_active'
        if (confirmResult === 'dont_remind_active') {
            console.log('独立填表弹窗已被禁止，自动执行。');
            EDITOR.info('“항상 예 선택”이 선택되었습니다. 작업은 백그라운드에서 자동으로 실행됩니다...'); // <--- 增加后台执行提示
        } else { // confirmResult === true
            console.log('用户确认执行独立填表 (或首次选择了“一直选是”并确认)');
        }
        manualSummaryChat(todoChats, confirmResult);
    }
}

/**
 * 手动总结聊天（立即填表）
 * 重构逻辑：
 * 1. 恢复：首先调用内建的 `undoSheets` 函数，将테이블状态恢复到上一版本。
 * 2. 执行：以恢复后的干净状态为基础，调用标准增量更新流程，向AI请求新的 작업并执行。
 * @param {Array} todoChats - 需要用于填表的聊天记录。
 * @param {string|boolean} confirmResult - 用户的确认结果。
 */
export async function manualSummaryChat(todoChats, confirmResult) {
    // 步骤一：检查是否需要执行“撤销” 작업
    // 首先获取当前的聊天片段，以判断테이블状态
    const { piece: initialPiece } = USER.getChatPiece();
    if (!initialPiece) {
        EDITOR.error("현재 채팅 기록을 가져올 수 없습니다. 작업이 중단됩니다.");
        return;
    }

    // 只有当테이블中已经有内容时，才执行“撤销并重做”
    if (initialPiece.hash_sheets && Object.keys(initialPiece.hash_sheets).length > 0) {
        console.log('[Memory Enhancement] 立即填表：检测到테이블中有数据，执行恢复 작업...');
        try {
            await undoSheets(0);
            EDITOR.success('테이블이 이전 버전으로 복원되었습니다.');
            console.log('[Memory Enhancement] 테이블恢复성공，准备执行填表。');
        } catch (e) {
            EDITOR.error('테이블 복원 실패, 작업이 중단되었습니다.');
            console.error('[Memory Enhancement] 调用 undoSheets 실패:', e);
            return;
        }
    } else {
        console.log('[Memory Enhancement] 立即填表：检测到为空表，跳过恢复步骤，直接执行填表。');
    }

    // 步骤二：以当前状态（可能已恢复）为基础，继续执行填表
    // 重新获取 piece，确保我们使用的是最新状态（无论是原始状态还是恢复后的状态）
    const { piece: referencePiece } = USER.getChatPiece();
    if (!referencePiece) {
        EDITOR.error("작업을 위한 채팅 기록을 가져올 수 없습니다. 작업이 중단됩니다.");
        return;
    }
    
    // 테이블数据
    const originText = getTablePrompt(referencePiece);

    // 테이블总体提示词
    const finalPrompt = initTableData(); // 获取테이블相关提示词
    
    // 设置
    const useMainApiForStepByStep = USER.tableBaseSetting.step_by_step_use_main_api ?? true;
    const isSilentMode = confirmResult === 'dont_remind_active';

    const r = await executeIncrementalUpdateFromSummary(
        todoChats,
        originText,
        finalPrompt,
        referencePiece, // 直接传递原始的 piece 对象引用
        useMainApiForStepByStep, // API choice for step-by-step
        USER.tableBaseSetting.bool_silent_refresh, // isSilentUpdate
        isSilentMode // Pass silent mode flag
    );

    console.log('执行独立填表（增量更新）结果:', r);
    if (r === 'success') {
        // 由于直接在 referencePiece 引用上 작업，修改已自动同步，无需手动回写 hash_sheets。
        toBeExecuted.forEach(chat => {
            const chatSwipeUid = getSwipeUid(chat);
            chat.two_step_links[chatSwipeUid].push(swipeUid);   // 标记已执行的两步总结
        });
        toBeExecuted = [];

        // 저장并새로고침UI
        await USER.saveChat();
        // 根据用户要求，使用整页새로고침来确保包括宏在内的所有数据都得到更新。
        reloadCurrentChat();
        return true;
    } else if (r === 'suspended' || r === 'error' || !r) {
        console.log('执行增量独立填表실패或取消: ', `(${todoChats.length}) `, toBeExecuted);
        return false;
    }
    
}
