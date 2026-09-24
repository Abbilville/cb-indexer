package cpg

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

var (
	// Regex patterns for fallback static code extraction
	goFuncRegex    = regexp.MustCompile(`(?m)^func\s+(?:\((?:[^)]+)\)\s+)?([A-Za-z0-9_]+)\s*\(([^)]*)\)`)
	goTypeRegex    = regexp.MustCompile(`(?m)^type\s+([A-Za-z0-9_]+)\s+(struct|interface)`)
	pyFuncRegex    = regexp.MustCompile(`(?m)^\s*def\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)`)
	pyClassRegex   = regexp.MustCompile(`(?m)^\s*class\s+([A-Za-z0-9_]+)`)
	javaMethodReg  = regexp.MustCompile(`(?m)^\s*(?:public|protected|private|static|\s)+[\w<>\[\]]+\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)\s*\{`)
	javaClassReg   = regexp.MustCompile(`(?m)^\s*(?:public\s+)?(?:class|interface|record)\s+([A-Za-z0-9_]+)`)
	jsFuncRegex    = regexp.MustCompile(`(?m)^\s*(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)`)
	jsClassRegex   = regexp.MustCompile(`(?m)^\s*class\s+([A-Za-z0-9_]+)`)
	callRegex      = regexp.MustCompile(`\b([A-Za-z0-9_]+)\s*\(`)
	importRegex    = regexp.MustCompile(`(?m)^\s*(?:import\s+(?:[\w{},\s*]+from\s+)?["']([^"']+)["']|from\s+([\w.]+)\s+import)`)
)

// FallbackAnalyzeRepo performs native source-level CPG extraction on a repository.
// Used when Joern CLI is not installed or for deterministic unit tests.
func FallbackAnalyzeRepo(repoPath string, projectName string) (*ExtractedCPG, map[string]string, error) {
	absPath, err := filepath.Abs(repoPath)
	if err != nil {
		return nil, nil, err
	}

	result := &ExtractedCPG{}
	fileHashes := make(map[string]string)
	var nextID int64 = 1

	err = filepath.Walk(absPath, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil || info == nil {
			return nil
		}
		if info.IsDir() {
			name := info.Name()
			if strings.HasPrefix(name, ".") || name == "node_modules" || name == "vendor" || name == "target" || name == "bin" {
				return filepath.SkipDir
			}
			return nil
		}

		ext := strings.ToLower(filepath.Ext(path))
		if !isSupportedCodeExt(ext) {
			return nil
		}

		relPath, _ := filepath.Rel(absPath, path)
		relPath = filepath.ToSlash(relPath)

		// Compute file hash
		hash, content, err := readFileAndHash(path)
		if err != nil {
			return nil
		}
		fileHashes[relPath] = hash

		// Create File Node
		fileID := nextID
		nextID++
		fileNode := CPGNode{
			ID:            fileID,
			Project:       projectName,
			Label:         NodeFile,
			Name:          filepath.Base(relPath),
			QualifiedName: fmt.Sprintf("%s::%s", projectName, relPath),
			FilePath:      relPath,
			StartLine:     1,
			Properties: map[string]any{
				"extension": ext,
				"language":  detectLanguage(ext),
			},
			Val: NodeWeight(NodeFile),
		}
		result.Nodes = append(result.Nodes, fileNode)

		// Extract entities from content
		extractEntitiesFromFile(content, relPath, projectName, fileNode, &nextID, result)
		return nil
	})

	if err != nil {
		return nil, nil, err
	}

	return result, fileHashes, nil
}

func isSupportedCodeExt(ext string) bool {
	switch ext {
	case ".go", ".java", ".py", ".js", ".ts", ".jsx", ".tsx", ".c", ".cpp", ".h", ".cs", ".php", ".kt":
		return true
	default:
		return false
	}
}

func detectLanguage(ext string) string {
	switch ext {
	case ".go":
		return "go"
	case ".java":
		return "java"
	case ".py":
		return "python"
	case ".js", ".jsx":
		return "javascript"
	case ".ts", ".tsx":
		return "typescript"
	case ".c", ".h", ".cpp":
		return "c_cpp"
	case ".cs":
		return "csharp"
	case ".php":
		return "php"
	case ".kt":
		return "kotlin"
	default:
		return "unknown"
	}
}

func readFileAndHash(filePath string) (string, string, error) {
	f, err := os.Open(filePath)
	if err != nil {
		return "", "", err
	}
	defer f.Close()

	hasher := sha256.New()
	var buf strings.Builder
	tee := io.TeeReader(f, hasher)

	data, err := io.ReadAll(tee)
	if err != nil {
		return "", "", err
	}
	buf.Write(data)

	return hex.EncodeToString(hasher.Sum(nil)), buf.String(), nil
}

func extractEntitiesFromFile(content, relPath, projectName string, fileNode CPGNode, nextID *int64, result *ExtractedCPG) {
	lines := strings.Split(content, "\n")
	ext := strings.ToLower(filepath.Ext(relPath))

	var activeTypeNode *CPGNode

	for lineIdx, line := range lines {
		lineNum := lineIdx + 1
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "//") || strings.HasPrefix(trimmed, "#") {
			continue
		}

		// 1. Imports
		if importMatch := importRegex.FindStringSubmatch(line); len(importMatch) > 1 {
			impName := importMatch[1]
			if impName == "" && len(importMatch) > 2 {
				impName = importMatch[2]
			}
			if impName != "" {
				impID := *nextID
				*nextID++
				impNode := CPGNode{
					ID:            impID,
					Project:       projectName,
					Label:         NodeImport,
					Name:          impName,
					QualifiedName: fmt.Sprintf("%s::%s::import::%s", projectName, relPath, impName),
					FilePath:      relPath,
					StartLine:     lineNum,
					EndLine:       lineNum,
					Properties:    map[string]any{"imported_entity": impName},
					Val:           NodeWeight(NodeImport),
				}
				result.Nodes = append(result.Nodes, impNode)
				result.Edges = append(result.Edges, CPGEdge{
					Project:  projectName,
					SourceID: fileNode.ID,
					TargetID: impID,
					Type:     EdgeImport,
				})
			}
		}

		// 2. Types / Classes
		var typeName string
		if ext == ".go" {
			if m := goTypeRegex.FindStringSubmatch(line); len(m) > 1 {
				typeName = m[1]
			}
		} else if ext == ".java" {
			if m := javaClassReg.FindStringSubmatch(line); len(m) > 1 {
				typeName = m[1]
			}
		} else if ext == ".py" {
			if m := pyClassRegex.FindStringSubmatch(line); len(m) > 1 {
				typeName = m[1]
			}
		} else if ext == ".js" || ext == ".ts" {
			if m := jsClassRegex.FindStringSubmatch(line); len(m) > 1 {
				typeName = m[1]
			}
		}

		if typeName != "" {
			tID := *nextID
			*nextID++
			tNode := CPGNode{
				ID:            tID,
				Project:       projectName,
				Label:         NodeTypeDecl,
				Name:          typeName,
				QualifiedName: fmt.Sprintf("%s::%s::%s", projectName, relPath, typeName),
				FilePath:      relPath,
				StartLine:     lineNum,
				EndLine:       lineNum + 10,
				Properties:    map[string]any{"type_name": typeName},
				Val:           NodeWeight(NodeTypeDecl),
			}
			result.Nodes = append(result.Nodes, tNode)
			activeTypeNode = &tNode

			// AST edge: File -> Type
			result.Edges = append(result.Edges, CPGEdge{
				Project:  projectName,
				SourceID: fileNode.ID,
				TargetID: tID,
				Type:     EdgeAST,
			})
		}

		// 3. Methods / Functions
		var funcName, paramStr string
		if ext == ".go" {
			if m := goFuncRegex.FindStringSubmatch(line); len(m) > 2 {
				funcName, paramStr = m[1], m[2]
			}
		} else if ext == ".java" {
			if m := javaMethodReg.FindStringSubmatch(line); len(m) > 2 {
				funcName, paramStr = m[1], m[2]
			}
		} else if ext == ".py" {
			if m := pyFuncRegex.FindStringSubmatch(line); len(m) > 2 {
				funcName, paramStr = m[1], m[2]
			}
		} else if ext == ".js" || ext == ".ts" {
			if m := jsFuncRegex.FindStringSubmatch(line); len(m) > 2 {
				funcName, paramStr = m[1], m[2]
			}
		}

		if funcName != "" {
			mID := *nextID
			*nextID++
			mNode := CPGNode{
				ID:            mID,
				Project:       projectName,
				Label:         NodeMethod,
				Name:          funcName,
				QualifiedName: fmt.Sprintf("%s::%s::%s", projectName, relPath, funcName),
				FilePath:      relPath,
				StartLine:     lineNum,
				EndLine:       lineNum + 5,
				Properties: map[string]any{
					"signature": fmt.Sprintf("%s(%s)", funcName, paramStr),
				},
				Val: NodeWeight(NodeMethod),
			}
			result.Nodes = append(result.Nodes, mNode)

			// AST edge: File/Type -> Method
			parentID := fileNode.ID
			if activeTypeNode != nil {
				parentID = activeTypeNode.ID
			}
			result.Edges = append(result.Edges, CPGEdge{
				Project:  projectName,
				SourceID: parentID,
				TargetID: mID,
				Type:     EdgeAST,
			})

			// Parameters
			var prevFlowID int64 = mID
			if paramStr != "" {
				params := strings.Split(paramStr, ",")
				for _, p := range params {
					pClean := strings.TrimSpace(p)
					if pClean == "" {
						continue
					}
					parts := strings.Fields(pClean)
					pName := parts[0]
					pID := *nextID
					*nextID++
					pNode := CPGNode{
						ID:            pID,
						Project:       projectName,
						Label:         NodeParam,
						Name:          pName,
						QualifiedName: fmt.Sprintf("%s::%s::%s::%s", projectName, relPath, funcName, pName),
						FilePath:      relPath,
						StartLine:     lineNum,
						EndLine:       lineNum,
						Properties:    map[string]any{"param_name": pName},
						Val:           NodeWeight(NodeParam),
					}
					result.Nodes = append(result.Nodes, pNode)

					// AST edge: Method -> Param
					result.Edges = append(result.Edges, CPGEdge{
						Project:  projectName,
						SourceID: mID,
						TargetID: pID,
						Type:     EdgeAST,
					})

					// Data-flow edge: Param -> Method
					result.Edges = append(result.Edges, CPGEdge{
						Project:  projectName,
						SourceID: pID,
						TargetID: mID,
						Type:     EdgeDataFlow,
					})
				}
			}

			// 4. Calls inside method body
			for j := lineIdx + 1; j < len(lines) && j < lineIdx+25; j++ {
				subLine := lines[j]
				if strings.TrimSpace(subLine) == "" {
					continue
				}
				// If new method begins, break
				if (ext == ".go" && strings.HasPrefix(subLine, "func ")) ||
					(ext == ".py" && strings.HasPrefix(subLine, "def ")) {
					break
				}

				callMatches := callRegex.FindAllStringSubmatch(subLine, -1)
				for _, cm := range callMatches {
					callee := cm[1]
					if isControlKeyword(callee) {
						continue
					}
					callID := *nextID
					*nextID++
					callNode := CPGNode{
						ID:            callID,
						Project:       projectName,
						Label:         NodeCall,
						Name:          callee,
						QualifiedName: fmt.Sprintf("%s::%s::call::%s::%d_%d", projectName, relPath, callee, j+1, callID),
						FilePath:      relPath,
						StartLine:     j + 1,
						EndLine:       j + 1,
						Properties:    map[string]any{"callee": callee},
						Val:           NodeWeight(NodeCall),
					}
					result.Nodes = append(result.Nodes, callNode)

					// AST edge: Method -> Call
					result.Edges = append(result.Edges, CPGEdge{
						Project:  projectName,
						SourceID: mID,
						TargetID: callID,
						Type:     EdgeAST,
					})

					// CALL edge: Method -> Call
					result.Edges = append(result.Edges, CPGEdge{
						Project:  projectName,
						SourceID: mID,
						TargetID: callID,
						Type:     EdgeCall,
					})

					// CFG edge: Sequential flow
					result.Edges = append(result.Edges, CPGEdge{
						Project:  projectName,
						SourceID: prevFlowID,
						TargetID: callID,
						Type:     EdgeCFG,
					})
					prevFlowID = callID
				}
			}
		}
	}
}

func isControlKeyword(name string) bool {
	switch name {
	case "if", "for", "switch", "while", "return", "case", "catch", "else", "make", "len", "append", "new":
		return true
	default:
		return false
	}
}
