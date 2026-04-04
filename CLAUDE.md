# CLAUDE.md

## Språk
- Svenska i kommunikation. Engelska i kod, commits, README.

## Tokeneffektivitet
- Upprepa aldrig uppgiftsbeskrivningen — gå direkt på lösningen.
- Förklara inte kod utan att bli ombedd.
- Planera inte högt — börja direkt.
- Bekräftelsefrågor ("kvittera", "klar"): svara med bara det ordet.
- Visa bara diff vid redigeringar, inte hela filen.
- Skriv aldrig licenstext inline — hämta med curl.

## Kodstandard
- Shell: bash, POSIX-kompatibelt där möjligt.
- Python: 3.10+, stdlib först, minimera beroenden.
- JavaScript/React: funktionella komponenter, hooks.
- Commits: engelska, imperativ form, max 72 tecken.

## Dokumentation
- Append-only logg: nya poster överst med datum.
- YAML `Last-Updated`-header i dokumentationsfiler.
- README: badges, tydlig install-sektion, professionell ton.

## Git
- Committa aldrig genererade filer, node_modules, .env eller tokens.
- Branch: feature/kort-beskrivning eller fix/kort-beskrivning.

## Leverans
- Avsluta uppdrag med verifieringschecklista (checkbox-format).
- Testa att det körs innan du rapporterar klart.
