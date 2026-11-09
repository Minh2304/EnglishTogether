# 🇬🇧 EnglishTogether - Smart Flashcard Extension & Cloud Sync

Bộ công cụ học tiếng Anh **EnglishTogether** bao gồm:
1. **Chrome/Edge Extension (`tools/FlashcardExtension`)**: Tiện ích học từ vựng Flashcard thông minh tích hợp từ điển gợi ý tự động, luyện tập 2 chiều Anh ↔ Việt và Popup kiểm tra định kỳ ở góc phải màn hình.
2. **Vercel Serverless Backend (`api/sync.js`)**: API lưu trữ và đồng bộ dữ liệu từ vựng + cài đặt người dùng theo địa chỉ **Gmail** trên mọi máy tính.
3. **Trình quản lý & tự động cập nhật (`EnglishTogether.bat`)**: Tự động tải (`git clone`) hoặc cập nhật (`git pull`) toàn bộ các tool trong repository mà không cần nâng cấp file `.bat` khi thêm tool mới trong tương lai.

---

## ✨ Tính năng nổi bật

- **Giao diện 2 Tab trực quan (`Flashcard` & `Setting`)**:
  - **Nút `+` ở góc trên bên trái** tab Flashcard: Mở rộng khung **Add Flashcard** mượt mà.
  - **Tự động gợi ý từ vựng & nghĩa Tiếng Việt**:
    - Gợi ý từ tiếng Anh đang gõ theo thời gian thực qua **Datamuse API**.
    - Kiểm tra từ hợp lệ, lấy phiên âm quốc tế (IPA), từ loại và phát âm chuẩn qua **Free Dictionary API**.
    - Tự động điền sẵn nghĩa gợi ý vào ô **Tiếng Việt** (qua Google Translate GTX Dictionary API & MyMemory API), kèm các chip từ đồng nghĩa để chọn nhanh hoặc tự chỉnh sửa theo ý muốn.
  - **Mục Practice đa chế độ (`All`, `15 words`, `30 words`)**:
    - Khi rê chuột vào từng gói luyện tập sẽ hiện nút **`Start ▶`**.
    - Hỗ trợ luyện tập **Tiếng Anh ➔ Tiếng Việt**, **Tiếng Việt ➔ Tiếng Anh**, hoặc **Ngẫu nhiên cả 2 chiều (EN ↔ VI)**.
- **Tab Setting & Popup Practice định kỳ**:
  - Lưu thông tin theo **Gmail** và cho phép chỉnh sửa **Tên hiển thị (Display Name)**.
  - Bật/Tắt **Popup Practice** và cài đặt chu kỳ thời gian (phút).
  - Cứ sau khoảng thời gian đã đặt, một thẻ Flashcard kiểm tra ngẫu nhiên sẽ hiện ở **góc trên bên phải màn hình**.
  - Có nút **`×`** nhỏ ở góc popup để tắt tạm thời hoặc tự động đóng khi nhập đúng đáp án, sau đó tiếp tục đếm ngược cho lần hiển thị tiếp theo.

---

## 🚀 Hướng dẫn sử dụng nhanh

### 1. Tải & Cập nhật Tool bằng `EnglishTogether.bat`
- Chạy file `EnglishTogether.bat` ở bất kỳ máy tính nào:
  - Nếu máy chưa có code, file `.bat` sẽ tự động tải toàn bộ repository từ GitHub về.
  - Nếu đã có, file `.bat` sẽ tự động `git pull` cập nhật tất cả các tool trong thư mục `tools/`.
  - Nhập `1` trong menu để sao chép nhanh đường dẫn cài đặt Extension vào Clipboard.

### 2. Cài đặt Extension vào Chrome / Microsoft Edge
1. Mở trình duyệt và truy cập `chrome://extensions` (hoặc `edge://extensions`).
2. Bật **Developer mode (Chế độ nhà phát triển)** ở góc trên bên phải.
3. Nhấn **Load unpacked (Tải tiện ích đã giải nén)** và chọn thư mục:
   ```text
   tools/FlashcardExtension
   ```

### 3. Deploy Server đồng bộ lên Vercel
1. Đẩy repository này lên GitHub (`https://github.com/Minh2304/EnglishTogether.git`).
2. Đăng nhập [Vercel](https://vercel.com) ➔ **Add New Project** ➔ Import repository `EnglishTogether` và nhấn **Deploy**.
3. *(Khuyên dùng để lưu trữ vĩnh viễn)*: Trong trang quản lý Project trên Vercel, vào tab **Storage** ➔ **Create Database** ➔ Chọn **Upstash Redis (Vercel KV)** (miễn phí) và nhấn **Connect to Project**. Vercel sẽ tự động thêm biến môi trường `KV_REST_API_URL` và `KV_REST_API_TOKEN`.
4. Copy đường dẫn domain Vercel của bạn (ví dụ `https://english-together.vercel.app`), mở Extension ➔ sang tab **Setting** ➔ nhập **Gmail** và **Vercel Server URL** ➔ nhấn **Lưu & Đồng bộ Vercel**.

