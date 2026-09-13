#!/usr/bin/env sh
# Выдать номер И записать его в журнал — одним вызовом.
#
#   ./note.sh FIND "Заголовок находки"            # текст с stdin
#   ./note.sh NEED "Вопрос?" <<'EOF'
#   - Сейчас: …
#   EOF
#   ./note.sh --topic partner-stage-c FIND "…"    # выбрать файл журнала явно
#
# Печатает выданный номер в stdout и путь к файлу в stderr.
#
# ## Зачем отдельно от next-id.sh
#
# `next-id.sh` выдаёт номер и на этом заканчивается. Дальше агент должен сам открыть
# сегодняшний журнал, найти нужный раздел и дописать в него — три действия, между которыми
# ничто не связывает. 12.09.2026 это дало два случая подряд: номер взят и не записан, а
# следующий агент получил тот же самый. Здесь выдача и запись — одна операция, поэтому
# «взял номер и забыл записать» перестаёт быть возможным состоянием.
#
# Счётчик НЕ дублируется: номер берётся вызовом `next-id.sh`, который лежит рядом и держит
# один счётчик на все worktree. Второй реализации той же логики тут нет намеренно — две
# копии счётчика разошлись бы ровно так же, как расходились до 2026-09-09.
set -eu

dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
topic=""

while [ $# -gt 0 ]; do
  case "$1" in
    --topic) topic=$2; shift 2 ;;
    --topic=*) topic=${1#--topic=}; shift ;;
    *) break ;;
  esac
done

[ $# -ge 2 ] || {
  echo "usage: $0 [--topic <тема>] <ПРЕФИКС> <заголовок>   (тело — со stdin)" >&2
  exit 2
}

prefix=$(printf '%s' "$1" | tr '[:lower:]' '[:upper:]')
title=$2
today=$(date +%F)

# Файл журнала: явная тема, иначе единственный сегодняшний, иначе отказ с подсказкой.
# Угадывать между двумя сегодняшними файлами нельзя — запись уехала бы в чужую сессию.
if [ -n "$topic" ]; then
  file="$dir/$today-$topic.md"
else
  matches=$(find "$dir" -maxdepth 1 -name "$today-*.md" | sort)
  count=$(printf '%s' "$matches" | grep -c . || true)
  if [ "$count" = "1" ]; then
    file=$matches
  elif [ "$count" = "0" ]; then
    echo "нет журнала за $today — заведи его из _TEMPLATE.md или укажи --topic" >&2
    exit 1
  else
    echo "сегодня несколько журналов, укажи --topic:" >&2
    printf '%s\n' "$matches" | sed 's|.*/||' >&2
    exit 1
  fi
fi

[ -f "$file" ] || { echo "нет файла $file" >&2; exit 1; }

# В какой из четырёх разделов класть. Порядок разделов задан шаблоном и не меняется.
case "$prefix" in
  TASK) section="## 1. Задачи" ;;
  ASK)  section="## 2. Вопросы Славы" ;;
  NEED) section="## 4. Вопросы к Славе" ;;
  *)    section="## 3. Находки" ;;
esac

body=$(cat)
id=$("$dir/next-id.sh" "$prefix")

# Дописываем В КОНЕЦ раздела, а не в конец файла: журнал грепают по префиксу, и находка,
# уехавшая под «Вопросы к Славе», находится, но читается как вопрос.
awk -v section="$section" -v entry="**$id · $title**
$body
" '
  BEGIN { placed = 0 }
  # Начало следующего раздела верхнего уровня — значит текущий кончился.
  /^## / {
    if (in_section && !placed) { print entry; placed = 1 }
    in_section = ($0 == section)
  }
  { print }
  END { if (in_section && !placed) { print ""; print entry } }
' "$file" > "$file.tmp"

# Раздела в файле может не оказаться — журнал, заведённый не из шаблона. Тогда лучше
# дописать в конец, чем потерять запись: номер уже выдан и второго такого не будет.
if ! grep -q "$id" "$file.tmp"; then
  { cat "$file"; printf '\n%s\n\n**%s · %s**\n%s\n' "$section" "$id" "$title" "$body"; } > "$file.tmp"
fi

mv "$file.tmp" "$file"

echo "$id"
echo "→ $file" >&2
