import {BASE, DERIVED, EDITOR, SYSTEM, USER} from '../../core/manager.js';
import {updateSystemMessageTableStatus, updateAlternateTable} from "../renderer/tablePushToChat.js";
import {rebuildSheets , modifyRebuildTemplate, newRebuildTemplate, deleteRebuildTemplate, exportRebuildTemplate, importRebuildTemplate, triggerStepByStepNow} from "../runtime/absoluteRefresh.js";
import {generateDeviceId} from "../../utils/utility.js";
import {updateModelList, handleApiTestRequest ,processApiKey} from "./standaloneAPI.js";
import {filterTableDataPopup} from "../../data/pluginSetting.js";
import {initRefreshTypeSelector} from "../runtime/absoluteRefresh.js";
import {rollbackVersion} from "../../services/debugs.js";
import {customSheetsStylePopup} from "../editor/customSheetsStyle.js";
import {openAppHeaderTableDrawer} from "../renderer/appHeaderTableBaseDrawer.js";

/**
 * 格式化深度设置
 */
function formatDeep() {
    USER.tableBaseSetting.deep = Math.abs(USER.tableBaseSetting.deep)
}

/**
 * 업데이트设置中的开关状态
 */
function updateSwitch(selector, switchValue) {
    if (switchValue) {
        $(selector).prop('checked', true);
    } else {
        $(selector).prop('checked', false);
    }
}

/**
 * 업데이트设置中的테이블结构DOM
 */
function updateTableView() {
    const show_drawer_in_extension_list = USER.tableBaseSetting.show_drawer_in_extension_list;
    const extensionsMenu = document.querySelector('#extensionsMenu');
    const show_settings_in_extension_menu = USER.tableBaseSetting.show_settings_in_extension_menu;
    const alternate_switch = USER.tableBaseSetting.alternate_switch;
    const extensions_settings = document.querySelector('#extensions_settings');

    if (show_drawer_in_extension_list === true) {
        // 如果不存在则创建
        if (document.querySelector('#drawer_in_extension_list_button')) return
        $(extensionsMenu).append(`
<div id="drawer_in_extension_list_button" class="list-group-item flex-container flexGap5 interactable">
    <div class="fa-solid fa-table extensionsMenuExtensionButton"></div>
    <span>메모리 향상 테이블</span>
</div>
`);
    
    // 设置点击事件
    $('#drawer_in_extension_list_button').on('click', () => {
        $('#table_drawer_icon').click();
        $('#table_drawer_content #setting_button').trigger('click');
        // openAppHeaderTableDrawer('database');
    });
    } else {
        document.querySelector('#drawer_in_extension_list_button')?.remove();
    }

//     if (show_drawer_in_extension_list === true) {
//         // 如果不存在则创建
//         if (document.querySelector('#drawer_in_extension_list_button')) return
//         $(extensions_settings).append(`
// <div id="drawer_in_extension_list_button" class="list-group-item flex-container flexGap5 interactable">
// </div>
// `);
//     } else {
//
//     }
}

function getSheetsCellStyle() {
    const style = document.createElement('style');  // 为 sheetContainer 的内容添加一个 style
    // 获取 sheetContainer 元素
    const cellWidth = USER.tableBaseSetting.table_cell_width_mode
    let sheet_cell_style_container = document.querySelector('#sheet_cell_style_container');
    if (sheet_cell_style_container) {
        // 清空现有的样式
        sheet_cell_style_container.innerHTML = '';
    } else {
        // 创建一个新的 sheet_cell_style_container 元素
        sheet_cell_style_container = document.createElement('div');
        sheet_cell_style_container.id = 'sheet_cell_style_container';
        document.body.appendChild(sheet_cell_style_container);
    }
    switch (cellWidth) {
        case 'single_line':
            style.innerHTML = ``;
            break;
        case 'wide1_cell':
            style.innerHTML = ` tr .sheet-cell { max-width: 800px !important; white-space: normal !important; } `;
            break;
        case 'wide1_2_cell':
            style.innerHTML = ` tr .sheet-cell { max-width: 400px !important; white-space: normal !important; } `;
            break;
        case 'wide1_4_cell':
            style.innerHTML = ` tr .sheet-cell { max-width: 200px !important; white-space: normal !important; } `;
            break;
    }
    sheet_cell_style_container.appendChild(style);
}

/**
 * 将테이블结构转为设置DOM
 * @param {object} tableStructure 테이블结构
 * @returns 设置DOM
 */
function tableStructureToSettingDOM(tableStructure) {
    const tableIndex = tableStructure.tableIndex;
    const $item = $('<div>', { class: 'dataTable_tableEditor_item' });
    const $index = $('<div>').text(`#${tableIndex}`); // 编号
    const $input = $('<div>', {
        class: 'tableName_pole margin0',
    });
    $input.text(tableStructure.tableName);
    const $checkboxLabel = $('<label>', { class: 'checkbox' });
    const $checkbox = $('<input>', { type: 'checkbox', 'data-index': tableIndex, checked: tableStructure.enable, class: 'tableEditor_switch' });
    $checkboxLabel.append($checkbox, '사용');
    const $editButton = $('<div>', {
        class: 'menu_button menu_button_icon fa-solid fa-pencil tableEditor_editButton',
        title: '편집',
        'data-index': tableIndex, // 绑定인덱스
    }).text('편집');
    $item.append($index, $input, $checkboxLabel, $editButton);
    return $item;
}

/**
 * 导入插件设置
 */
async function importTableSet() {
    // 创建一个 input 元素，用于选择文件
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json'; // 限制文件类型为 JSON

    // 监听 input 元素的 change 事件，当用户选择文件后触发
    input.addEventListener('change', async (event) => {
        const file = event.target.files[0]; // 获取用户选择的文件

        if (!file) {
            return; // 用户未选择文件，直接返回
        }

        const reader = new FileReader(); // 创建 FileReader 对象来读取文件内容

        reader.onload = async (e) => {
            try {
                const importedData = JSON.parse(e.target.result); // 파싱 JSON 文件内容

                // 获取导入 JSON 的第一级 key
                const firstLevelKeys = Object.keys(importedData);

                // 构建展示第一级 key 的 HTML 结构
                let keyListHTML = '<ul>';
                firstLevelKeys.forEach(key => {
                    keyListHTML += `<li>${key}</li>`;
                });
                keyListHTML += '</ul>';

                const tableInitPopup = $(`<div>
                    <p>곧 가져올 설정 항목 (1단계):</p>
                    ${keyListHTML}
                    <p>이 설정들을 계속 가져오고 초기화하시겠습니까？</p>
                </div>`);

                const confirmation = await EDITOR.callGenericPopup(tableInitPopup, EDITOR.POPUP_TYPE.CONFIRM, '설정 가져오기 확인', { okButton: "계속 가져오기", cancelButton: "취소" });
                if (!confirmation) return; // 用户取消导入

                // 用户确认导入后，进行数据应用
                // 注意：这里假设你需要将 importedData 的所有内容都合并到 USER.tableBaseSetting 中
                // 你可能需要根据实际需求调整数据合并逻辑，例如只合并第一级 key 对应的数据，或者进行更细粒度的合并
                for (let key in importedData) {
                    USER.tableBaseSetting[key] = importedData[key];
                }

                renderSetting(); // 重新渲染设置界面，应用新的设置
                // 重新转换模板
                initTableStructureToTemplate()
                BASE.refreshTempView(true) // 새로고침模板视图
                EDITOR.success('가져오기 성공, 선택한 설정이 초기화되었습니다.'); // 提示用户导入성공

            } catch (error) {
                EDITOR.error('JSON 파일 해석에 실패했습니다. 파일 형식이 올바른지 확인해주세요.', error.message, error); // 提示 JSON 解析失败
                console.error("파일 읽기 또는 해석 오류:", error); // 打印详细错误信息到控制台
            }
        };

        reader.onerror = (error) => {
            EDITOR.error(`파일 읽기 실패`, error.message, error); // 提示文件读取失败
        };

        reader.readAsText(file); // 以文本格式读取文件内容
    });

    input.click(); // 模拟点击 input 元素，弹出文件选择框
}


/**
 * 导出插件设置
 */
async function exportTableSet() {
    templateToTableStructure()
    const { filterData, confirmation } = await filterTableDataPopup(USER.tableBaseSetting,"내보낼 데이터를 선택해주세요","")
    if (!confirmation) return;

    try {
        const blob = new Blob([JSON.stringify(filterData)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a')
        a.href = url;
        a.download = `tableCustomConfig-${SYSTEM.generateRandomString(8)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        EDITOR.success('내보내기 성공');
    } catch (error) {
        EDITOR.error(`내보내기 실패`, error.message, error);
    }
}

/**
 * 重置设置
 */
async function resetSettings() {
    const { filterData, confirmation } = await filterTableDataPopup(USER.tableBaseDefaultSettings, "초기화할 데이터를 선택해주세요","초기화하기 전에 데이터를 백업하는 것을 권장합니다")
    if (!confirmation) return;

    try {
        for (let key in filterData) {
            USER.tableBaseSetting[key] = filterData[key]
        }
        renderSetting()
        if('tableStructure' in filterData){
            initTableStructureToTemplate()
            BASE.refreshTempView(true)
        }
        EDITOR.success('선택한 설정이 초기화되었습니다');
    } catch (error) {
        EDITOR.error(`설정 초기화 실패`, error.message, error);
    }
}

function InitBinging() {
    console.log('바인딩 초기화')
    // 开始绑定事件
    // 导入预设
    $('#table-set-import').on('click', () => importTableSet());
    // 导出
    $("#table-set-export").on('click', () => exportTableSet());
    // 重置设置
    $("#table-reset").on('click', () => resetSettings());
    // 回退테이블2.0到1.0
    $("#table-init-from-2-to-1").on('click', async () => {
        if (await rollbackVersion() === true) {
            window.location.reload()
        }
    });
    // 插件总体开关
    $('#table_switch').change(function () {
        USER.tableBaseSetting.isExtensionAble = this.checked;
        EDITOR.success(this.checked ? '플러그인이 활성화되었습니다' : '플러그인이 비활성화되었습니다，열어서 수동으로 테이블을 편집할 수 있습니다, AI는 테이블을 읽고 생성하지 않습니다');
        updateSystemMessageTableStatus();   // 将테이블 데이터状态업데이트到系统消息中
    });
    // 调试模式开关
    $('#table_switch_debug_mode').change(function () {
        USER.tableBaseSetting.tableDebugModeAble = this.checked;
        EDITOR.success(this.checked ? '디버그 모드 활성화' : '디버그 모드 비활성화');
    });
    // 插件读테이블开关
    $('#table_read_switch').change(function () {
        USER.tableBaseSetting.isAiReadTable = this.checked;
        EDITOR.success(this.checked ? 'AI 테이블 읽기' : 'AI 테이블 읽기 중지');
    });
    // 插件写테이블开关
    $('#table_edit_switch').change(function () {
        USER.tableBaseSetting.isAiWriteTable = this.checked;
        EDITOR.success(this.checked ? 'AI 변경 사항 기록' : 'AI 변경 사항 기록 중지');
    });

    // 테이블삽입模式
    $('#dataTable_injection_mode').change(function (event) {
        USER.tableBaseSetting.injection_mode = event.target.value;
    });
    $("#fill_table_time").change(function() {
        const value = $(this).val();
        const step_by_step = value === 'after'
        $('#reply_options').toggle(!step_by_step);
        $('#step_by_step_options').toggle(step_by_step);
        USER.tableBaseSetting.step_by_step = step_by_step;
    })
    // 确认执行
    $('#confirm_before_execution').change(function() {
        USER.tableBaseSetting.confirm_before_execution = $(this).prop('checked');
    })
    // //整理테이블相关高级设置
    // $('#advanced_settings').change(function() {
    //     $('#advanced_options').toggle(this.checked);
    //     USER.tableBaseSetting.advanced_settings = this.checked;
    // });
    // 忽略删除
    $('#ignore_del').change(function() {
        USER.tableBaseSetting.bool_ignore_del = $(this).prop('checked');
    });
    // 忽略用户回复
    $('#ignore_user_sent').change(function() {
        USER.tableBaseSetting.ignore_user_sent = $(this).prop('checked');
    });
    // // 强制새로고침
    // $('#bool_force_refresh').change(function() {
    //     USER.tableBaseSetting.bool_force_refresh = $(this).prop('checked');
    // });
    // 静默새로고침
    $('#bool_silent_refresh').change(function() {
        USER.tableBaseSetting.bool_silent_refresh = $(this).prop('checked');
    });
    //token限制代替楼层限制
    $('#use_token_limit').change(function() {
        $('#token_limit_container').toggle(this.checked);
        $('#clear_up_stairs_container').toggle(!this.checked);
        USER.tableBaseSetting.use_token_limit = this.checked;
    });
    // 初始化API设置显示状态
    $('#use_main_api').change(function() {
        USER.tableBaseSetting.use_main_api = this.checked;
    });
    // 初始化API设置显示状态
    $('#step_by_step_use_main_api').change(function() {
        USER.tableBaseSetting.step_by_step_use_main_api = this.checked;
    });
    // 根据下拉열테이블选择的模型업데이트自定义模型名称
    $('#model_selector').change(function(event) {
        $('#custom_model_name').val(event.target.value);
        USER.IMPORTANT_USER_PRIVACY_DATA.custom_model_name = event.target.value;
        USER.saveSettings && USER.saveSettings(); // 저장设置
    });
    // 테이블推送至对话开关
    $('#table_to_chat').change(function () {
        USER.tableBaseSetting.isTableToChat = this.checked;
        EDITOR.success(this.checked ? '채팅 중 테이블 푸시' : '채팅 중 테이블 푸시 중지');
        $('#table_to_chat_options').toggle(this.checked);
        updateSystemMessageTableStatus();   // 将테이블 데이터状态업데이트到系统消息中
    });
    // 在扩展菜单栏中显示테이블设置开关
    $('#show_settings_in_extension_menu').change(function () {
        USER.tableBaseSetting.show_settings_in_extension_menu = this.checked;
        updateTableView();
    });
    // 在扩展菜单栏中显示穿插模型设置开关
    $('#alternate_switch').change(function () {
        USER.tableBaseSetting.alternate_switch = this.checked;
        EDITOR.success(this.checked ? '테이블 렌더링 교대 모드 활성화' : '테이블 렌더링 교대 모드 비활성화');
        updateTableView();
        updateAlternateTable();
    });
    // 在扩展열테이블显示테이블设置
    $('#show_drawer_in_extension_list').change(function () {
        USER.tableBaseSetting.show_drawer_in_extension_list = this.checked;
        updateTableView();
    });
    // 推送至前端的테이블 데이터可被编辑
    $('#table_to_chat_can_edit').change(function () {
        USER.tableBaseSetting.table_to_chat_can_edit = this.checked;
        updateSystemMessageTableStatus();   // 将테이블 데이터状态업데이트到系统消息中
    });
    // 根据下拉열테이블选择테이블推送位置
    $('#table_to_chat_mode').change(function(event) {
        USER.tableBaseSetting.table_to_chat_mode = event.target.value;
        $('#table_to_chat_is_micro_d').toggle(event.target.value === 'macro');
        updateSystemMessageTableStatus();   // 将테이블 데이터状态업데이트到系统消息中
    });

    // 根据下拉열테이블选择테이블推送位置
    $('#table_cell_width_mode').change(function(event) {
        USER.tableBaseSetting.table_cell_width_mode = event.target.value;
        getSheetsCellStyle()
    });


    // API URL
    $('#custom_api_url').on('input', function() {
        USER.IMPORTANT_USER_PRIVACY_DATA.custom_api_url = $(this).val();
        USER.saveSettings && USER.saveSettings(); // 저장设置
    });
    // API KEY
    let apiKeyDebounceTimer;
    $('#custom_api_key').on('input', function () {
        clearTimeout(apiKeyDebounceTimer);
        apiKeyDebounceTimer = setTimeout(async () => {
            try {
                const rawKey = $(this).val();
                const result = processApiKey(rawKey, generateDeviceId());
                USER.IMPORTANT_USER_PRIVACY_DATA.custom_api_key = result.encryptedResult.encrypted || result.encryptedResult;
                USER.saveSettings && USER.saveSettings(); // 저장设置
                EDITOR.success(result.message);
            } catch (error) {
                console.error('API Key 처리 실패:', error);
                EDITOR.error('API 키를 가져올 수 없습니다. 다시 입력해 주세요~', error.message, error);
            }
        }, 500); // 500ms防抖延迟
    })
    // 模型名称
    $('#custom_model_name').on('input', function() {
        USER.IMPORTANT_USER_PRIVACY_DATA.custom_model_name = $(this).val();
        USER.saveSettings && USER.saveSettings(); // 저장设置
    });
    // 테이블消息模板
    $('#dataTable_message_template').on("input", function () {
        const value = $(this).val();
        USER.tableBaseSetting.message_template = value;
    })
    // 테이블深度
    $('#dataTable_deep').on("input", function () {
        const value = $(this).val();
        USER.tableBaseSetting.deep = Math.abs(value);
    })
    // 分步填테이블 데이터
    $('#step_by_step_user_prompt').on('input', function() {
        USER.tableBaseSetting.step_by_step_user_prompt = $(this).val();
    });
    // 分步填테이블读取的上下文层数
    $('#separateReadContextLayers').on('input', function() {
        USER.tableBaseSetting.separateReadContextLayers = Number($(this).val());
    });
    // 分步填테이블是否读取世界书
    $('#separateReadLorebook').change(function() {
        USER.tableBaseSetting.separateReadLorebook = this.checked;
        USER.saveSettings && USER.saveSettings();
    });
    // 重置分步填테이블 데이터为默认值
    $('#reset_step_by_step_user_prompt').on('click', function() {
        const defaultValue = USER.tableBaseDefaultSettings.step_by_step_user_prompt;
        $('#step_by_step_user_prompt').val(defaultValue);
        // 同样업데이트内存中的设置
        USER.tableBaseSetting.step_by_step_user_prompt = defaultValue;
        EDITOR.success('단계별 표 데이터가 기본값으로 초기화되었습니다');
    });
    // 清理聊天记录楼层
    $('#clear_up_stairs').on('input', function() {
        const value = $(this).val();
        $('#clear_up_stairs_value').text(value);
        USER.tableBaseSetting.clear_up_stairs = Number(value);
    });
    // token限制
    $('#rebuild_token_limit').on('input', function() {
        const value = $(this).val();
        $('#rebuild_token_limit_value').text(value);
        USER.tableBaseSetting.rebuild_token_limit_value = Number(value);
    });
    // 模型温度设定
    $('#custom_temperature').on('input', function() {
        const value = $(this).val();
        $('#custom_temperature_value').text(value);
        USER.tableBaseSetting.custom_temperature = Number(value);
    });

    // 代理地址
    $('#table_proxy_address').on('input', function() {
        USER.IMPORTANT_USER_PRIVACY_DATA.table_proxy_address = $(this).val();
        USER.saveSettings && USER.saveSettings(); // 저장设置
    });
    // 代理密钥
    $('#table_proxy_key').on('input', function() {
        USER.IMPORTANT_USER_PRIVACY_DATA.table_proxy_key = $(this).val();
        USER.saveSettings && USER.saveSettings(); // 저장设置
    });

    // 获取模型열테이블
    $('#fetch_models_button').on('click', updateModelList);

    // 테스트 API
    $(document).on('click', '#table_test_api_button',async () => {
        const apiUrl = $('#custom_api_url').val();
        const modelName = $('#custom_model_name').val();
        const encryptedApiKeys = USER.IMPORTANT_USER_PRIVACY_DATA.custom_api_key;
        const results = await handleApiTestRequest(apiUrl, encryptedApiKeys, modelName);
    });

    // 开始整理테이블
    $("#table_clear_up").on('click', () => {
        rebuildSheets()
    });

    // 完整重建테이블（合并到上面的下拉框内）
    // $('#rebuild_table').on('click', () => rebuildTableActions(USER.tableBaseSetting.bool_force_refresh, USER.tableBaseSetting.bool_silent_refresh));

    // 테이블推送至对话
    $("#dataTable_to_chat_button").on("click", async function () {
        customSheetsStylePopup()
    })

    // 重整理模板编辑
    $("#rebuild--set-rename").on("click", modifyRebuildTemplate)
    $("#rebuild--set-new").on("click", newRebuildTemplate)
    $("#rebuild--set-delete").on("click", deleteRebuildTemplate)
    $("#rebuild--set-export").on("click", exportRebuildTemplate)
    $("#rebuild--set-import").on("click", importRebuildTemplate)
    $('#rebuild--select').on('change', function() {
        USER.tableBaseSetting.lastSelectedTemplate = $(this).val();
        USER.saveSettings && USER.saveSettings();
    });

    // 手动触发分步填테이블
    $(document).on('click', '#trigger_step_by_step_button', () => {
        triggerStepByStepNow();
    });

}

/**
 * 渲染设置
 */
export function renderSetting() {
    // 初始化数值
    $(`#dataTable_injection_mode option[value="${USER.tableBaseSetting.injection_mode}"]`).prop('selected', true);
    $(`#table_to_chat_mode option[value="${USER.tableBaseSetting.table_to_chat_mode}"]`).prop('selected', true);
    $(`#table_cell_width_mode option[value="${USER.tableBaseSetting.table_cell_width_mode}"]`).prop('selected', true);
    $('#dataTable_message_template').val(USER.tableBaseSetting.message_template);
    $('#dataTable_deep').val(USER.tableBaseSetting.deep);
    $('#clear_up_stairs').val(USER.tableBaseSetting.clear_up_stairs);
    $('#clear_up_stairs_value').text(USER.tableBaseSetting.clear_up_stairs);
    $('#rebuild_token_limit').val(USER.tableBaseSetting.rebuild_token_limit_value);
    $('#rebuild_token_limit_value').text(USER.tableBaseSetting.rebuild_token_limit_value);
    $('#custom_temperature').val(USER.tableBaseSetting.custom_temperature);
    $('#custom_temperature_value').text(USER.tableBaseSetting.custom_temperature);
    // Load step-by-step user prompt
    $('#step_by_step_user_prompt').val(USER.tableBaseSetting.step_by_step_user_prompt || '');
    // 分步填테이블读取的上下文层数
    $('#separateReadContextLayers').val(USER.tableBaseSetting.separateReadContextLayers);
    // 分步填테이블是否读取世界书
    updateSwitch('#separateReadLorebook', USER.tableBaseSetting.separateReadLorebook);
    $("#fill_table_time").val(USER.tableBaseSetting.step_by_step ? 'after' : 'chat');
    refreshRebuildTemplate()

    // private data
    $('#custom_api_url').val(USER.IMPORTANT_USER_PRIVACY_DATA.custom_api_url || '');
    $('#custom_api_key').val(USER.IMPORTANT_USER_PRIVACY_DATA.custom_api_key || '');
    $('#custom_model_name').val(USER.IMPORTANT_USER_PRIVACY_DATA.custom_model_name || '');
    $('#table_proxy_address').val(USER.IMPORTANT_USER_PRIVACY_DATA.table_proxy_address || '');
    $('#table_proxy_key').val(USER.IMPORTANT_USER_PRIVACY_DATA.table_proxy_key || '');

    // 初始化开关状态
    updateSwitch('#table_switch', USER.tableBaseSetting.isExtensionAble);
    updateSwitch('#table_switch_debug_mode', USER.tableBaseSetting.tableDebugModeAble);
    updateSwitch('#table_read_switch', USER.tableBaseSetting.isAiReadTable);
    updateSwitch('#table_edit_switch', USER.tableBaseSetting.isAiWriteTable);
    updateSwitch('#table_to_chat', USER.tableBaseSetting.isTableToChat);
    // updateSwitch('#advanced_settings', USER.tableBaseSetting.advanced_settings);
    updateSwitch('#confirm_before_execution', USER.tableBaseSetting.confirm_before_execution);
    updateSwitch('#use_main_api', USER.tableBaseSetting.use_main_api);
    updateSwitch('#step_by_step_use_main_api', USER.tableBaseSetting.step_by_step_use_main_api);
    updateSwitch('#ignore_del', USER.tableBaseSetting.bool_ignore_del);
    // updateSwitch('#bool_force_refresh', USER.tableBaseSetting.bool_force_refresh);
    updateSwitch('#bool_silent_refresh', USER.tableBaseSetting.bool_silent_refresh);
    // updateSwitch('#use_token_limit', USER.tableBaseSetting.use_token_limit);
    updateSwitch('#ignore_user_sent', USER.tableBaseSetting.ignore_user_sent);
    updateSwitch('#show_settings_in_extension_menu', USER.tableBaseSetting.show_settings_in_extension_menu);
    updateSwitch('#alternate_switch', USER.tableBaseSetting.alternate_switch);
    updateSwitch('#show_drawer_in_extension_list', USER.tableBaseSetting.show_drawer_in_extension_list);
    updateSwitch('#table_to_chat_can_edit', USER.tableBaseSetting.table_to_chat_can_edit);
    $('#reply_options').toggle(!USER.tableBaseSetting.step_by_step);
    $('#step_by_step_options').toggle(USER.tableBaseSetting.step_by_step);
    $('#table_to_chat_options').toggle(USER.tableBaseSetting.isTableToChat);
    $('#table_to_chat_is_micro_d').toggle(USER.tableBaseSetting.table_to_chat_mode === 'macro');

    // 不再在设置中显示테이블结构
    // updateTableStructureDOM()
    console.log("설정이 이미 렌더링되었습니다.")
}

/**
 * 加载设置
 */
export function loadSettings() {
    USER.IMPORTANT_USER_PRIVACY_DATA = USER.IMPORTANT_USER_PRIVACY_DATA || {};

    // 旧版本提示词变更兼容
    if (USER.tableBaseSetting.updateIndex < 3) {
        USER.getSettings().message_template = USER.tableBaseDefaultSettings.message_template
        USER.tableBaseSetting.to_chat_container = USER.tableBaseDefaultSettings.to_chat_container
        // USER.tableBaseSetting.tableStructure = USER.tableBaseDefaultSettings.tableStructure
        USER.tableBaseSetting.updateIndex = 3
    }

    // 2版本테이블结构兼容
    console.log("updateIndex", USER.tableBaseSetting.updateIndex)
    if (USER.tableBaseSetting.updateIndex < 4) {
        // tableStructureToTemplate(USER.tableBaseSetting.tableStructure)
        initTableStructureToTemplate()
        USER.tableBaseSetting.updateIndex = 4
    }
    if (USER.tableBaseSetting.deep < 0) formatDeep()

    renderSetting();
    InitBinging();
    initRefreshTypeSelector(); // 初始化테이블새로고침类型选择器
    updateTableView(); // 업데이트테이블视图
    getSheetsCellStyle()
}

export function initTableStructureToTemplate() {
    const sheetDefaultTemplates = USER.tableBaseSetting.tableStructure
    USER.getSettings().table_selected_sheets = []
    USER.getSettings().table_database_templates = [];
    for (let defaultTemplate of sheetDefaultTemplates) {
        const newTemplate = new BASE.SheetTemplate()
        newTemplate.domain = 'global'
        newTemplate.createNewTemplate(defaultTemplate.columns.length + 1, 1, false)
        newTemplate.name = defaultTemplate.tableName
        defaultTemplate.columns.forEach((column, index) => {
            newTemplate.findCellByPosition(0, index + 1).data.value = column
        })
        newTemplate.enable = defaultTemplate.enable
        newTemplate.tochat = defaultTemplate.tochat
        newTemplate.required = defaultTemplate.Required
        newTemplate.triggerSend = defaultTemplate.triggerSend
        newTemplate.triggerSendDeep = defaultTemplate.triggerSendDeep
        if(defaultTemplate.config)
            newTemplate.config = JSON.parse(JSON.stringify(defaultTemplate.config))
        newTemplate.source.data.note = defaultTemplate.note
        newTemplate.source.data.initNode = defaultTemplate.initNode
        newTemplate.source.data.deleteNode = defaultTemplate.deleteNode
        newTemplate.source.data.updateNode = defaultTemplate.updateNode
        newTemplate.source.data.insertNode = defaultTemplate.insertNode
        USER.getSettings().table_selected_sheets.push(newTemplate.uid)
        newTemplate.save()
    }
    USER.saveSettings()
}

function templateToTableStructure() {
    const tableTemplates = BASE.templates.map((templateData, index) => {
        const template = new BASE.SheetTemplate(templateData.uid)
        return {
            tableIndex: index,
            tableName: template.name,
            columns: template.hashSheet[0].slice(1).map(cellUid => template.cells.get(cellUid).data.value),
            note: template.data.note,
            initNode: template.data.initNode,
            deleteNode: template.data.deleteNode,
            updateNode: template.data.updateNode,
            insertNode: template.data.insertNode,
            config: JSON.parse(JSON.stringify(template.config)),
            Required: template.required,
            tochat: template.tochat,
            enable: template.enable,
            triggerSend: template.triggerSend,
            triggerSendDeep: template.triggerSendDeep,
        }
    })
    USER.tableBaseSetting.tableStructure = tableTemplates
    USER.saveSettings()
}

/**
 * 새로고침重整理模板
 */
export function refreshRebuildTemplate() {
    const templateSelect = $('#rebuild--select');
    templateSelect.empty(); // 清空现有选项
    const defaultOption = $('<option>', {
        value: "rebuild_base",
        text: "기본값",
    });
    templateSelect.append(defaultOption);
    Object.keys(USER.tableBaseSetting.rebuild_message_template_list).forEach(key => {
        const option = $('<option>', {
            value: key,
            text: key
        });
        templateSelect.append(option);
    });
    // 设置默认选中项
    if (USER.tableBaseSetting.lastSelectedTemplate) {
        console.log("기본값", USER.tableBaseSetting.lastSelectedTemplate)
        $('#rebuild--select').val(USER.tableBaseSetting.lastSelectedTemplate);
    }
}
