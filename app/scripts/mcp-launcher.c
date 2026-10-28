#include <mach-o/dyld.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

int main(int argc, char **argv) {
    char executable[PATH_MAX], resolved[PATH_MAX];
    uint32_t size = sizeof(executable);
    if (_NSGetExecutablePath(executable, &size) != 0 || !realpath(executable, resolved)) {
        fprintf(stderr, "Creator Compiler MCP: cannot locate the bundled launcher.\n");
        return 127;
    }
    char *separator = strrchr(resolved, '/');
    if (!separator) return 127;
    *separator = '\0';
    char engine[PATH_MAX], entry[PATH_MAX];
    int engineLength = snprintf(engine, sizeof(engine), "%s/Creator Compiler", resolved);
    int entryLength = snprintf(entry, sizeof(entry), "%s/../Resources/app/server-dist/mcp-entry.mjs", resolved);
    if (engineLength < 0 || entryLength < 0 || engineLength >= (int)sizeof(engine) || entryLength >= (int)sizeof(entry)) {
        fprintf(stderr, "Creator Compiler MCP: bundled path is too long.\n");
        return 127;
    }
    char **forwarded = calloc((size_t)argc + 2, sizeof(char *));
    if (!forwarded || setenv("ELECTRON_RUN_AS_NODE", "1", 1) != 0) {
        perror("Creator Compiler MCP");
        free(forwarded);
        return 127;
    }
    forwarded[0] = engine;
    forwarded[1] = entry;
    for (int i = 1; i < argc; i++) forwarded[i + 1] = argv[i];
    execv(engine, forwarded);
    perror("Creator Compiler MCP: could not start the bundled service");
    free(forwarded);
    return 127;
}
