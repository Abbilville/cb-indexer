package gitwatcher

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"strings"
	"time"
)

// GetRepoCommitHash returns the current HEAD commit hash of a git repository.
func GetRepoCommitHash(ctx context.Context, repoPath string) (string, error) {
	execCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	cmd := exec.CommandContext(execCtx, "git", "rev-parse", "HEAD")
	cmd.Dir = repoPath
	var outBuf bytes.Buffer
	cmd.Stdout = &outBuf

	if err := cmd.Run(); err != nil {
		return "", err
	}
	return strings.TrimSpace(outBuf.String()), nil
}

// GitFetch runs git fetch origin with a timeout.
func GitFetch(ctx context.Context, repoPath string) error {
	execCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	cmd := exec.CommandContext(execCtx, "git", "fetch", "origin")
	cmd.Dir = repoPath
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	return cmd.Run()
}

// GitPull attempts git pull origin on the active branch, returning whether new commits were pulled.
func GitPull(ctx context.Context, repoPath string) (bool, error) {
	beforeHash, _ := GetRepoCommitHash(ctx, repoPath)

	execCtx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(execCtx, "git", "pull", "--ff-only")
	cmd.Dir = repoPath
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	var outBuf, errBuf bytes.Buffer
	cmd.Stdout = &outBuf
	cmd.Stderr = &errBuf

	if err := cmd.Run(); err != nil {
		errStr := strings.TrimSpace(errBuf.String())
		if errStr != "" {
			return false, fmt.Errorf("%s", errStr)
		}
		return false, err
	}

	afterHash, _ := GetRepoCommitHash(ctx, repoPath)
	return beforeHash != "" && afterHash != "" && beforeHash != afterHash, nil
}
