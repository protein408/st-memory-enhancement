import {BASE, EDITOR, USER} from "../../core/manager.js";
import {updateSystemMessageTableStatus} from "../renderer/tablePushToChat.js";

export async function customSheetsStylePopup() {
    const customStyleEditor = `
<div class="column-editor">
    <div class="popup-content">
        대화창으로 전송되는 테이블을 감싸는(wrapper) 스타일을 사용자 정의할 수 있습니다. HTML과 CSS를 지원하며, $0을 사용하여 테이블이 삽입될 위치를 지정합니다
    </div>
    <div class="column-editor-body">
        <textarea id="customStyleEditor" class="column-editor-textarea" rows="30" placeholder="사용자 정의 스타일 입력"></textarea>
    </div>
</div>
`
    const customStylePopup = new EDITOR.Popup(customStyleEditor, EDITOR.POPUP_TYPE.CONFIRM, '', { large: true, okButton: "수정 적용", cancelButton: "취소" });
    const styleContainer = $(customStylePopup.dlg)[0];
    const resultDataContainer = styleContainer.querySelector("#customStyleEditor");
    resultDataContainer.style.display = "flex";
    resultDataContainer.style.flexDirection = "column";
    resultDataContainer.style.flexGrow = "1";
    resultDataContainer.style.width = "100%";
    resultDataContainer.style.height = "100%";

    // 获取resultDataContainer中的resultData
    let resultData = USER.tableBaseSetting.to_chat_container;
    // 如果没有resultData，则使用默认值
    if (!resultData) {
        resultData = `<div class="table-container"><div class="table-content">$0</div></div>`;
    }
    // 设置resultDataContainer的值
    resultDataContainer.value = resultData;

    await customStylePopup.show();
    if (customStylePopup.result) {
        USER.tableBaseSetting.to_chat_container = resultDataContainer.value;
        updateSystemMessageTableStatus()
    }
    // console.log(resultDataContainer.value)
}
