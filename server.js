const express = require('express');
const app = express();
const http = require('http').createServer(app);
const cors = require('cors');

app.use(cors());
app.use(express.static('.'));

const io = require('socket.io')(http, {
    cors: { origin: "*", methods: ["GET", "POST"] }
});

let activeOrders = {};  // เก็บรายการออเดอร์ที่ห้องครัวกำลังทำ
let activeTables = {};  // เก็บข้อมูลโต๊ะที่กำลังกินอยู่ และ ยอดรวมเงินทั้งหมดของโต๊ะนั้น {"1": { expires: 12345, grandTotal: 500 }}

app.get('/', (req, res) => {
    res.sendFile(__dirname + '/admin.html');
});

io.on('connection', (socket) => {
    // ส่งข้อมูลตั้งต้นให้แอดมินเห็นออเดอร์ค้างทั้งหมดเมื่อเปิดหน้าจอ
    socket.emit('init-orders', activeOrders);

    // 1. ลงทะเบียนเปิดโต๊ะใหม่ และเซ็ตยอดเริ่มต้นเป็น 0 บาท
    socket.on('open-table', (data) => {
        activeTables[data.table] = {
            expires: parseInt(data.expires),
            grandTotal: 0
        };
        console.log(`[ระบบ] เปิดโต๊ะอลาคาร์ท โต๊ะ ${data.table} สำเร็จ`);
    });

    // 2. ตรวจสอบสถานะสิทธิ์ของโต๊ะเมื่อลูกค้าสแกนเข้ามา (รองรับ callback ปลอดภัย)
    socket.on('check-table-status', (data, callback) => {
        const tableData = activeTables[data.table];
        
        if (typeof callback !== 'function') return; // ป้องกันระบบพังหากไม่มีการส่ง callback มา

        if (!tableData) {
            callback({ status: 'closed', message: 'โต๊ะนี้ยังไม่ได้เปิดระบบ หรือถูกเช็คบิลเรียบร้อยแล้ว' });
        } else if (Date.now() > tableData.expires) {
            delete activeTables[data.table]; 
            callback({ status: 'expired', message: 'หมดเวลาทานอาหาร 90 นาทีแล้วครับ' });
        } else {
            callback({ status: 'active', expires: tableData.expires });
        }
    });

    // 3. ลูกค้าส่งออเดอร์เข้ามา (แก้ไขเพื่อให้รองรับโค้ดฝั่งหน้าเว็บทุกเวอร์ชัน ออเดอร์เข้าแน่นอน)
    socket.on('submit-order', (data, callback) => {
        // 🛠️ แก้ไข: หากเปิดโต๊ะจากหน้าแอดมินไม่ทัน ให้สร้างข้อมูลโต๊ะเริ่มต้นให้อัตโนมัติเพื่อป้องกันออเดอร์หลุด
        if (!activeTables[data.table]) {
            activeTables[data.table] = {
                expires: Date.now() + (90 * 60 * 1000), // ให้เวลาตั้งต้น 90 นาที
                grandTotal: 0
            };
        }

        const orderId = Date.now().toString();
        const newOrder = {
            id: orderId,
            table: data.table,
            items: data.items,
            totalPrice: data.totalPrice,
            status: "กำลังทำ"
        };
        
        activeOrders[orderId] = newOrder;

        // 💰 ลอจิกอลาคาร์ท: บวกเงินสะสมเพิ่มเข้าไปในบิลหลักของโต๊ะนี้
        activeTables[data.table].grandTotal += data.totalPrice;

        // ยิงข้อมูลอัปเดตไปให้หน้าจอ admin.html ทันที
        io.emit('order-updated', activeOrders);
        
        // 🛠️ แก้ไข: ตรวจสอบก่อนเรียกใช้งาน callback เพื่อป้องกัน Java/Node.js เกิด Error
        if (typeof callback === 'function') {
            callback({ success: true });
        }
    });

    // 4. พนักงานกด "เสิร์ฟแล้ว"
    socket.on('mark-done', (orderId) => {
        if (activeOrders[orderId]) {
            activeOrders[orderId].status = "เสิร์ฟแล้ว";
            io.emit('order-updated', activeOrders);
        }
    });

    // 5. พนักงานกดชำระเงิน (ระบบจะดึงยอดรวมสะสมทั้งหมดของโต๊ะมาพ่นบอกที่คอนโซล)
    socket.on('clear-table', (tableNum) => {
        const totalBill = activeTables[tableNum] ? activeTables[tableNum].grandTotal : 0;
        
        console.log(`💰 [ชำระเงิน] โต๊ะที่ ${tableNum} เช็คบิลแล้ว ยอดรวมรวมทั้งหมด: ${totalBill} บาท`);

        // ตัดสิทธิ์โต๊ะทันที
        delete activeTables[tableNum];

        // ลบออเดอร์ค้างของโต๊ะนี้ออกจากครัว
        Object.keys(activeOrders).forEach(id => {
            if (activeOrders[id].table === tableNum) {
                delete activeOrders[id];
            }
        });
        io.emit('order-updated', activeOrders);
    });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
    console.log(`🚀 อลาคาร์ทระบบเซิร์ฟเวอร์เปิดใช้งานที่พอร์ต http://localhost:${PORT}`);
});
