import {profile_prompts} from "../../data/profile_prompts.js";

/**
 * 初始化테이블새로고침类型选择器
 * 根据profile_prompts对象动态生成下拉选择器的选项
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
                switch(value.type) {
                    case 'refresh':
                        return '**이전** ' + (value.name || key);
                    case 'third_party':
                        return '**제3자 저자** ' + (value.name || key);
                    default:
                        return value.name || key;
                }
            })());
        $selector.append(option);
    });
    
    // 如果没有选项，添加默认选项
    if ($selector.children().length === 0) {
        $selector.append($('<option></option>').attr('value', 'rebuild_base').text('~~~이 옵션이 보인다면 문제가 발생했다는 뜻입니다~~~~'));
    }

    console.log('테이블 새로고침 유형 선택기가 이미 업데이트됨');

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
    //             currentOption.text !== ((value.type=='refresh'? '**旧** ':'')+value.name|| key)) {
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
        
    //     console.log('테이블새로고침类型选择器已업데이트');
}