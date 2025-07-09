import {BASE, DERIVED, EDITOR, SYSTEM, USER} from '../manager.js';

/**
 * 将单元格中的逗号替换为/符号
 * @param {string | number} cell
 * @returns 处理后的单元格值
 */
function handleCellValue(cell) {
    if (typeof cell === 'string') {
        return cell.replace(/,/g, "/")
    } else if (typeof cell === 'number') {
        return cell
    }
    return ''
}

/**
 * 在테이블末尾삽입行
 * @deprecated
 * @param {number} tableIndex 테이블 인덱스
 * @param {object} data 삽입的数据
 * @returns 新삽입行的인덱스
 */
export function insertRow(tableIndex, data) {
    if (tableIndex == null) return EDITOR.error('insert함수，tableIndex함수가 비어 있습니다');
    if (data == null) return EDITOR.error('insert함수，data함수가 비어 있습니다');

    // 获取테이블对象，支持新구시스템
    const table = DERIVED.any.waitingTable[tableIndex];

    // 检查是否为新系统的Sheet对象
    if (table.uid && table.hashSheet) {
        // 新系统：使用Sheet类API
        try {
            // 获取当前行数（不包括테이블头）
            const rowCount = table.hashSheet.length - 1;

            // 在最后一行后面삽입新行
            const cell = table.findCellByPosition(0, 0); // 获取테이블源单元格
            cell.newAction('insertDownRow'); // 在最后一行后삽입新行

            // 填充数据
            Object.entries(data).forEach(([key, value]) => {
                const colIndex = parseInt(key) + 1; // +1 因为第一열是행 인덱스
                if (colIndex < table.hashSheet[0].length) {
                    const cell = table.findCellByPosition(rowCount + 1, colIndex);
                    if (cell) {
                        cell.data.value = handleCellValue(value);
                    }
                }
            });

            console.log(`삽입 성공: table ${tableIndex}, row ${rowCount + 1}`);
            return rowCount + 1;
        } catch (error) {
            console.error('행 삽입 실패:', error);
            return -1;
        }
    } else {
        // 구시스템：保持原有逻辑
        const newRowArray = new Array(table.columns.length).fill("");
        Object.entries(data).forEach(([key, value]) => {
            newRowArray[parseInt(key)] = handleCellValue(value);
        });

        const dataStr = JSON.stringify(newRowArray);
        // 检查是否已存在相同行
        if (table.content.some(row => JSON.stringify(row) === dataStr)) {
            console.log(`중복 삽입 건너뛰기: table ${tableIndex}, data ${dataStr}`);
            return -1; // 返回-1表示未삽입
        }
        table.content.push(newRowArray);
        const newRowIndex = table.content.length - 1;
        console.log(`삽입 성공 (구시스템): table ${tableIndex}, row ${newRowIndex}`);
        return newRowIndex;
    }
}

/**
 * 행 삭제
 * @deprecated
 * @param {number} tableIndex 테이블 인덱스
 * @param {number} rowIndex 행 인덱스
 */
export function deleteRow(tableIndex, rowIndex) {
    if (tableIndex == null) return EDITOR.error('delete함수，tableIndex함수가 비어 있습니다');
    if (rowIndex == null) return EDITOR.error('delete함수，rowIndex함수가 비어 있습니다');

    // 获取테이블对象，支持新구시스템
    const table = DERIVED.any.waitingTable[tableIndex];

    // 检查是否为新系统的Sheet对象
    if (table.uid && table.hashSheet) {
        // 新系统：使用Sheet类API
        try {
            // 确保행 인덱스有效（考虑테이블头行）
            const actualRowIndex = rowIndex + 1; // +1 因为第一行是테이블头

            // 检查행 인덱스是否有效
            if (actualRowIndex >= table.hashSheet.length || actualRowIndex <= 0) {
                console.error(`유효하지 않은 행 인덱스: ${rowIndex}`);
                return;
            }

            // 获取要행 삭제的单元格并触发删除 작업
            const cell = table.findCellByPosition(actualRowIndex, 0);
            if (cell) {
                cell.newAction('deleteSelfRow');
                console.log(`삭제 성공: table ${tableIndex}, row ${rowIndex}`);
            } else {
                console.error(`행을 찾을 수 없습니다: ${rowIndex}`);
            }
        } catch (error) {
            console.error('행 삭제 실패:', error);
        }
    } else {
        // 구시스템：保持原有逻辑
        if (table.content && rowIndex >= 0 && rowIndex < table.content.length) {
            table.content.splice(rowIndex, 1);
            console.log(`삭제 성공 (구시스템): table ${tableIndex}, row ${rowIndex}`);
        } else {
            console.error(`삭제 실패 (구시스템): table ${tableIndex}, 유효하지 않은 행 인덱스 ${rowIndex} 또는 content가 존재하지 않습니다`);
        }
    }
}

/**
 * 업데이트单个行的信息
 * @deprecated
 * @param {number} tableIndex 테이블 인덱스
 * @param {number} rowIndex 행 인덱스
 * @param {object} data 업데이트的数据
 */
export function updateRow(tableIndex, rowIndex, data) {
    if (tableIndex == null) return EDITOR.error('update함수，tableIndex함수가 비어 있습니다');
    if (rowIndex == null) return EDITOR.error('update함수，rowIndex함수가 비어 있습니다');
    if (data == null) return EDITOR.error('update함수，data함수가 비어 있습니다');

    // 获取테이블对象，支持新구시스템
    const table = DERIVED.any.waitingTable[tableIndex];

    // 检查是否为新系统的Sheet对象
    if (table.uid && table.hashSheet) {
        // 新系统：使用Sheet类API
        try {
            // 确保행 인덱스有效（考虑테이블头行）
            const actualRowIndex = rowIndex + 1; // +1 因为第一行是테이블头

            // 检查행 인덱스是否有效
            if (actualRowIndex >= table.hashSheet.length || actualRowIndex <= 0) {
                console.error(`유효하지 않은 행 인덱스: ${rowIndex}`);
                return;
            }

            // 업데이트行数据
            Object.entries(data).forEach(([key, value]) => {
                const colIndex = parseInt(key) + 1; // +1 因为第一열是행 인덱스
                if (colIndex < table.hashSheet[0].length) {
                    const cell = table.findCellByPosition(actualRowIndex, colIndex);
                    if (cell) {
                        cell.data.value = handleCellValue(value);
                    }
                }
            });

            // 변경 사항 저장
            table.save();
            console.log(`업데이트 성공: table ${tableIndex}, row ${rowIndex}`);
        } catch (error) {
            console.error('행 업데이트 실패:', error);
        }
    } else {
        // 구시스템：保持原有逻辑
        if (table.content && table.content[rowIndex]) {
            Object.entries(data).forEach(([key, value]) => {
                table.content[rowIndex][parseInt(key)] = handleCellValue(value);
            });
            console.log(`업데이트 성공 (구시스템): table ${tableIndex}, row ${rowIndex}`);
        } else {
            console.error(`업데이트 실패 (구시스템): table ${tableIndex}, row ${rowIndex} 존재하지 않거나 content가 존재하지 않습니다`);
        }
    }
}
