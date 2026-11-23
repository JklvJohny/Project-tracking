package document_test

import (
	"bytes"
	"io"
	"mime/multipart"
	"net/textproto"
	"strings"
	"testing"
)

// templateBody writes the text fields first, then the file, as the client does.
func templateBody(fields map[string]string, filename string, content []byte) (*bytes.Buffer, string) {
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for _, k := range []string{"category", "name", "description"} {
		if v, ok := fields[k]; ok {
			_ = mw.WriteField(k, v)
		}
	}
	hdr := textproto.MIMEHeader{}
	hdr.Set("Content-Disposition", `form-data; name="file"; filename="`+filename+`"`)
	hdr.Set("Content-Type", "application/octet-stream")
	part, _ := mw.CreatePart(hdr)
	_, _ = part.Write(content)
	_ = mw.Close()
	return &buf, mw.FormDataContentType()
}

func (e env) uploadTemplate(user int64, fields map[string]string, filename string, content []byte) (int, map[string]any) {
	b, ct := templateBody(fields, filename, content)
	rec, body := e.call(user, "POST", "/report-templates", b, ct)
	return rec.Code, body
}

func zip(extra string) []byte { return []byte("PK\x03\x04" + extra) }

func TestTemplates_UploadListDownload(t *testing.T) {
	e := newEnv(t)
	// Anyone signed in may add one, a viewer or someone outside every project included.
	code, body := e.uploadTemplate(outside, map[string]string{"category": " รายงานประจำสัปดาห์ ", "description": "ใช้ทุกวันศุกร์"}, "Weekly Report.docx", zip("word"))
	if code != 201 {
		t.Fatalf("upload = %d %v", code, body)
	}
	d := data(body)
	if d["category"] != "รายงานประจำสัปดาห์" || d["name"] != "Weekly Report" || d["filename"] != "Weekly Report.docx" ||
		d["mimeType"] != "application/vnd.openxmlformats-officedocument.wordprocessingml.document" {
		t.Fatalf("template = %v", d)
	}
	if _, leaked := d["storageKey"]; leaked {
		t.Error("storage key must not reach the client")
	}
	if code, _ := e.uploadTemplate(viewer, map[string]string{"category": "Budget", "name": "Q1 budget"}, "b.xlsx", zip("x")); code != 201 {
		t.Fatalf("xlsx = %d", code)
	}
	if code, _ := e.uploadTemplate(member, map[string]string{"category": "Budget", "name": "Approval"}, "a.pdf", pdf("p")); code != 201 {
		t.Fatalf("pdf = %d", code)
	}

	rec, body := e.call(viewer, "GET", "/report-templates", nil, "")
	list, _ := body["data"].([]any)
	if rec.Code != 200 || len(list) != 3 {
		t.Fatalf("list = %d %s", rec.Code, rec.Body)
	}
	// Category, then name, case-insensitively.
	var got []string
	for _, x := range list {
		m := x.(map[string]any)
		got = append(got, m["category"].(string)+"/"+m["name"].(string))
	}
	if strings.Join(got, ",") != "Budget/Approval,Budget/Q1 budget,รายงานประจำสัปดาห์/Weekly Report" {
		t.Fatalf("order = %v", got)
	}

	id := idStr(map[string]any{"data": list[2]})
	rec, _ = e.call(member, "GET", "/report-templates/"+id+"/file", nil, "")
	if rec.Code != 200 || rec.Body.String() != string(zip("word")) {
		t.Fatalf("download = %d %q", rec.Code, rec.Body)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.Contains(ct, "wordprocessingml") {
		t.Errorf("content-type = %q", ct)
	}
	if cd := rec.Header().Get("Content-Disposition"); !strings.HasPrefix(cd, "attachment;") {
		t.Errorf("disposition = %q", cd)
	}
}

func TestTemplates_RejectsBadInput(t *testing.T) {
	e := newEnv(t)
	cases := []struct {
		name, file, field, want string
		fields                  map[string]string
		content                 []byte
	}{
		{"exe", "x.exe", "file", "unsupported_type", map[string]string{"category": "A"}, []byte("MZ")},
		{"doc renamed pdf", "x.pdf", "file", "unsupported_type", map[string]string{"category": "A"}, zip("x")},
		{"zip renamed doc", "x.doc", "file", "unsupported_type", map[string]string{"category": "A"}, zip("x")},
		{"no category", "x.pdf", "category", "required", map[string]string{}, pdf("x")},
		{"blank category", "x.pdf", "category", "required", map[string]string{"category": "  "}, pdf("x")},
		{"long name", "x.pdf", "name", "too_long", map[string]string{"category": "A", "name": strings.Repeat("ก", 121)}, pdf("x")},
	}
	for _, c := range cases {
		code, body := e.uploadTemplate(member, c.fields, c.file, c.content)
		if code != 422 || fieldOf(body, c.field) != c.want {
			t.Errorf("%s: %d %v", c.name, code, body)
		}
	}
	if _, body := e.call(member, "GET", "/report-templates", nil, ""); len(body["data"].([]any)) != 0 {
		t.Error("a rejected upload must not leave a row")
	}
}

func TestTemplates_EditDeleteRestore(t *testing.T) {
	e := newEnv(t)
	_, body := e.uploadTemplate(member, map[string]string{"category": "Weekly"}, "w.pptx", zip("p"))
	id := idStr(body)

	rec, body := e.call(other, "PATCH", "/report-templates/"+id, strings.NewReader(`{"category":"Monthly","description":"x"}`), "application/json")
	if rec.Code != 200 || data(body)["category"] != "Monthly" || data(body)["name"] != "w" || data(body)["description"] != "x" {
		t.Fatalf("patch = %d %s", rec.Code, rec.Body)
	}
	if rec, body := e.call(other, "PATCH", "/report-templates/"+id, strings.NewReader(`{"name":""}`), "application/json"); rec.Code != 422 || fieldOf(body, "name") != "required" {
		t.Fatalf("blank name = %d %s", rec.Code, rec.Body)
	}

	if rec, _ := e.call(viewer, "DELETE", "/report-templates/"+id, nil, ""); rec.Code != 200 {
		t.Fatalf("delete = %d %s", rec.Code, rec.Body)
	}
	if _, body := e.call(member, "GET", "/report-templates", nil, ""); len(body["data"].([]any)) != 0 {
		t.Fatal("a deleted template must leave the list")
	}
	if rec, body := e.call(member, "GET", "/report-templates/"+id+"/file", nil, ""); rec.Code != 404 || body["code"] != "not_found" {
		t.Fatalf("deleted download = %d", rec.Code)
	}
	if rec, body := e.call(member, "PATCH", "/report-templates/"+id, strings.NewReader(`{"name":"y"}`), "application/json"); rec.Code != 404 || body["code"] != "not_found" {
		t.Fatalf("deleted patch = %d", rec.Code)
	}

	rec, body = e.call(member, "POST", "/report-templates/"+id+"/restore", nil, "")
	if rec.Code != 200 || data(body)["category"] != "Monthly" {
		t.Fatalf("restore = %d %s", rec.Code, rec.Body)
	}
	rec, _ = e.call(member, "GET", "/report-templates/"+id+"/file", nil, "")
	if b, _ := io.ReadAll(rec.Body); rec.Code != 200 || string(b) != string(zip("p")) {
		t.Fatalf("restored download = %d", rec.Code)
	}
	if rec, _ := e.call(member, "DELETE", "/report-templates/999", nil, ""); rec.Code != 404 {
		t.Fatalf("missing = %d", rec.Code)
	}
}

func TestTemplates_LegacyOfficeFormats(t *testing.T) {
	e := newEnv(t)
	ole := func(extra string) []byte { return []byte("\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1" + extra) }
	for file, mime := range map[string]string{
		"form.doc": "application/msword", "sheet.XLS": "application/vnd.ms-excel", "deck.ppt": "application/vnd.ms-powerpoint",
	} {
		code, body := e.uploadTemplate(member, map[string]string{"category": "Old"}, file, ole(file))
		if code != 201 || data(body)["mimeType"] != mime {
			t.Errorf("%s = %d %v", file, code, body)
		}
	}
}

// With no name typed, the name comes from the file; a file name longer than a
// name may be is cut to fit instead of failing with "name too long".
func TestTemplates_LongFileNameBecomesAShortenedName(t *testing.T) {
	e := newEnv(t)
	long := strings.Repeat("ร", 150)
	code, body := e.uploadTemplate(member, map[string]string{"category": "Budget"}, long+".docx", zip("w"))
	if code != 201 {
		t.Fatalf("upload = %d %v", code, body)
	}
	if n := data(body)["name"].(string); len([]rune(n)) != 120 {
		t.Fatalf("name has %d characters, want 120", len([]rune(n)))
	}
}
