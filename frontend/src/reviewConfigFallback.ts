import type { ReviewConfig, ReviewRuleId } from './types'

export const DEFAULT_RULES: ReviewRuleId[] = [
  'title', 'description', 'preconditions', 'steps', 'postconditions',
  'priority', 'expected_results', 'test_data', 'tags',
  'atomicity', 'independence', 'reproducibility',
]

export function buildFallbackConfig(language: string): ReviewConfig {
  const isRu = language === 'ru'
  const rule = (id: ReviewRuleId, en: [string, string], ru: [string, string], group: string, order: number) => ({
    id, label: isRu ? ru[0] : en[0], description: isRu ? ru[1] : en[1], group, enabled: true, order,
  })
  return {
    sources: [{ id: 'testit', label: 'TestIT', enabled: true }],
    profiles: [
      {
        id: 'standard',
        label: isRu ? 'Базовая проверка' : 'Standard review',
        description: isRu ? 'Базовые проверки' : 'Basic checks',
        rules: ['title', 'description', 'preconditions', 'steps', 'expected_results', 'test_data', 'reproducibility'],
      },
      {
        id: 'strict',
        label: isRu ? 'Строгая проверка' : 'Strict review',
        description: isRu ? 'Включены все проверки' : 'All checks enabled',
        rules: DEFAULT_RULES,
      },
    ],
    rules: [
      rule('title', ['Title', 'Title is readable, not in snake_case/kebab-case, reflects the scenario.'], ['Заголовок', 'Заголовок читаем, не в snake_case/kebab-case, отражает сценарий.'], 'Case quality', 10),
      rule('description', ['Description', 'Description is present, does not duplicate the title or contradict the steps.'], ['Описание', 'Описание присутствует, не дублирует заголовок и не противоречит шагам.'], 'Case quality', 12),
      rule('preconditions', ['Preconditions', 'Preconditions describe system state, not actions. No references to other test cases.'], ['Предусловия', 'Предусловия описывают состояние системы, а не действия. Нет ссылок на другие тест-кейсы.'], 'Case quality', 15),
      rule('steps', ['Steps', 'Each step contains one action. The order of steps is logically possible.'], ['Шаги', 'Каждый шаг содержит одно действие. Порядок шагов логически возможен.'], 'Case quality', 17),
      rule('postconditions', ['Postconditions', 'The final system state after the test is described.'], ['Постусловия', 'Описано конечное состояние системы после теста.'], 'Case quality', 18),
      rule('priority', ['Priority', 'Priority matches the criticality of the scenario.'], ['Приоритет', 'Приоритет соответствует критичности сценария.'], 'Metadata', 19),
      rule('expected_results', ['Expected results', 'Each significant step has a specific expected result.'], ['Ожидаемые результаты', 'У каждого значимого шага есть конкретный ожидаемый результат.'], 'Case quality', 20),
      rule('test_data', ['Test data', 'Data is explicitly specified in a separate field, not embedded in the action text.'], ['Тестовые данные', 'Данные явно указаны в отдельном поле, а не встроены в текст действия.'], 'Case quality', 30),
      rule('tags', ['Tags', 'Tags match the case content: type, level, module.'], ['Теги', 'Теги соответствуют содержанию кейса: тип, уровень, модуль.'], 'Metadata', 40),
      rule('atomicity', ['Atomicity', 'One case contains one verification goal.'], ['Атомарность', 'Один кейс содержит одну цель проверки.'], 'Case quality', 60),
      rule('independence', ['Independence', 'Case runs in any order without dependency on other tests.'], ['Независимость', 'Кейс выполняется в любом порядке без зависимости от других тестов.'], 'Case quality', 70),
      rule('reproducibility', ['Reproducibility', 'Case can be run without verbal explanations from the author.'], ['Воспроизводимость', 'Кейс можно выполнить без устных пояснений автора.'], 'Case quality', 90),
    ],
    defaults: { testit: DEFAULT_RULES },
  }
}
