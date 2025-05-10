'use client';

export default function FileUpload() {
    const handleFileUpload = async (event: any) => {
        const file = event.target.files[0];
        const formData = new FormData();
        formData.append('pdf', file);

        await fetch('/api/extract', {
            method: 'POST',
            body: formData
        })
    }
    return (
        <input type='file' accept="application/pdf" onChange={handleFileUpload} />
    )
}